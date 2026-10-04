import React, { useState, useEffect, useRef } from 'react';
import RiskGauge from './RiskGauge';
import RiskTimelineChart from './RiskTimelineChart';
import AlertBanner from './AlertBanner';
import AcousticTelemetry from './AcousticTelemetry';
import { BACKEND_WS_URL, BACKEND_HOST } from '../config';

export default function WebRTCCall({ onBackToDashboard }) {
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'vox-call-secure';
  });

  const [callState, setCallState] = useState('idle'); // 'idle' | 'connecting' | 'waiting' | 'connected' | 'ended'
  const [isMuted, setIsMuted] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);

  // Live Forensic Scoring States
  const [liveScore, setLiveScore] = useState(0);
  const [isAlert, setIsAlert] = useState(false);
  const [scoreHistory, setScoreHistory] = useState([]);
  const [latestTelemetry, setLatestTelemetry] = useState({});
  const [capturedPackets, setCapturedPackets] = useState(0);
  const [callDuration, setCallDuration] = useState(0);

  // WebRTC References
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const signalingWsRef = useRef(null);
  const scoringWsRef = useRef(null);
  const audioContextRef = useRef(null);
  const callStartTimestampRef = useRef(null);
  const timerIntervalRef = useRef(null);


  // Timer updater
  useEffect(() => {
    if (callState === 'connected') {
      callStartTimestampRef.current = Date.now();
      timerIntervalRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTimestampRef.current) / 1000));
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [callState]);

  const endCall = () => {
    setCallState('ended');

    // Stop local mic
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Close WebRTC connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Close WebSockets
    if (signalingWsRef.current) {
      signalingWsRef.current.close();
      signalingWsRef.current = null;
    }

    if (scoringWsRef.current) {
      scoringWsRef.current.close();
      scoringWsRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  // Clean shutdown on unmount
  useEffect(() => {
    return () => {
      endCall();
    };
  }, []);

  const copyRoomLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?view=call&room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const generateRandomRoom = () => {
    const rand = `vox-${Math.random().toString(36).substring(2, 8)}`;
    setRoomId(rand);
  };

  const startCall = async () => {
    if (!roomId.trim()) {
      alert('Please enter a Room ID.');
      return;
    }

    setCallState('connecting');
    setLiveScore(0);
    setIsAlert(false);
    setScoreHistory([]);
    setCapturedPackets(0);
    setCallDuration(0);

    try {
      // 1. Get Local Microphone Stream
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localStreamRef.current = localStream;

      // 2. Fetch ICE Servers configuration from backend
      let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      try {
        const cfgRes = await fetch(`${window.location.protocol}//${BACKEND_HOST}:8000/webrtc/config`);
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg.iceServers) iceServers = cfg.iceServers;
        }
      } catch (e) {
        console.warn('Using default STUN server:', e);
      }

      // 3. Initialize RTCPeerConnection
      const pc = new RTCPeerConnection({ iceServers });
      peerConnectionRef.current = pc;

      // Add local audio tracks to send to peer
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && signalingWsRef.current?.readyState === WebSocket.OPEN) {
          signalingWsRef.current.send(JSON.stringify({
            type: 'candidate',
            candidate: event.candidate
          }));
        }
      };

      // Handle incoming remote media track
      pc.ontrack = (event) => {
        console.log('[WebRTC] Received remote audio track');
        setCallState('connected');

        // Play remote peer audio
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch((err) => console.warn('Audio play autoplay error:', err));
        }

        // Tap the incoming remote track ONLY (not local mic) for forensic scoring
        tapRemoteAudioForScoring(event.track);
      };

      // 4. Connect to Signaling WebSocket
      const signalWsUrl = `${BACKEND_WS_URL}/ws/signal/${encodeURIComponent(roomId)}`;
      const signalWs = new WebSocket(signalWsUrl);
      signalingWsRef.current = signalWs;

      signalWs.onopen = () => {
        console.log('[Signaling] Connected to room:', roomId);
      };

      signalWs.onmessage = async (msgEvent) => {
        try {
          const msg = JSON.parse(msgEvent.data);

          if (msg.type === 'JOINED') {
            setPeerCount(msg.peer_count || 1);
            if (msg.peer_count === 1) {
              setCallState('waiting');
            } else if (msg.is_initiator) {
              // We are the second peer to join: initiate SDP Offer
              console.log('[WebRTC] Creating SDP Offer...');
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              signalWs.send(JSON.stringify({ type: 'offer', offer }));
            }
          } else if (msg.type === 'PEER_JOINED') {
            console.log('[Signaling] Peer joined. Creating SDP Offer...');
            setPeerCount(2);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            signalWs.send(JSON.stringify({ type: 'offer', offer }));
          } else if (msg.type === 'offer') {
            console.log('[WebRTC] Handling SDP Offer...');
            await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signalWs.send(JSON.stringify({ type: 'answer', answer }));
          } else if (msg.type === 'answer') {
            console.log('[WebRTC] Handling SDP Answer...');
            await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
          } else if (msg.type === 'candidate') {
            if (msg.candidate) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
          } else if (msg.type === 'PEER_LEFT') {
            console.log('[Signaling] Remote peer disconnected');
            setPeerCount(1);
            setCallState('waiting');
          }
        } catch (err) {
          console.error('[Signaling] Message error:', err);
        }
      };

      signalWs.onerror = (e) => {
        console.error('[Signaling] WebSocket error:', e);
      };

      signalWs.onclose = () => {
        console.log('[Signaling] Connection closed');
      };
    } catch (err) {
      console.error('[WebRTC] Error joining call:', err);
      alert(`Could not start call: ${err.message}. Please ensure microphone permission is granted.`);
      endCall();
    }
  };

  // Tap remote audio track and stream 1.5s PCM chunks to /ws/call/{room_id}
  const tapRemoteAudioForScoring = (remoteTrack) => {
    try {
      const incomingStream = new MediaStream([remoteTrack]);

      // Connect to scoring WebSocket
      const scoreWsUrl = `${BACKEND_WS_URL}/ws/call/${encodeURIComponent(roomId)}`;
      const scoreWs = new WebSocket(scoreWsUrl);
      scoringWsRef.current = scoreWs;

      scoreWs.onopen = () => {
        console.log('[Scoring] Connected to Formant inference stream for call:', roomId);
      };

      scoreWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.risk_score !== undefined) {
            setLiveScore(data.risk_score);
            setIsAlert(Boolean(data.alert));
            if (data.telemetry) {
              setLatestTelemetry(data.telemetry);
            }
            setScoreHistory((prev) => [
              ...prev,
              {
                relative_sec: Math.round(((Date.now() - (callStartTimestampRef.current || Date.now())) / 100)) / 10,
                risk_score: data.risk_score,
                alert: Boolean(data.alert)
              }
            ]);
          }
        } catch (e) {
          console.warn('[Scoring] JSON parse error:', e);
        }
      };

      // Set up Web Audio API to tap remote audio PCM directly
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(incomingStream);
      const bufferSize = 4096;
      const scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      let accumulated = [];
      const targetSamples = 16000 * 1.5; // ~1.5s window @ 16kHz
      const nativeRate = audioCtx.sampleRate;

      scriptNode.onaudioprocess = (e) => {
        const channelData = e.inputBuffer.getChannelData(0);
        // Resample to 16,000 Hz if native rate differs
        const resampled = downsampleBuffer(channelData, nativeRate, 16000);
        for (let i = 0; i < resampled.length; i++) {
          accumulated.push(resampled[i]);
        }

        if (accumulated.length >= targetSamples) {
          const chunkFloats = new Float32Array(accumulated);
          accumulated = [];

          // Convert to 16-bit PCM little-endian
          const pcmBuffer = floatTo16BitPCM(chunkFloats);
          if (scoreWs.readyState === WebSocket.OPEN) {
            scoreWs.send(pcmBuffer);
            setCapturedPackets((p) => p + 1);
          }
        }
      };

      source.connect(scriptNode);
      // Connect to zero-gain destination to keep processor active without echoing
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      scriptNode.connect(muteGain);
      muteGain.connect(audioCtx.destination);
    } catch (err) {
      console.error('[Scoring] Error tapping audio:', err);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };



  // Signal / Audio Helpers
  function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate >= sampleRate) return buffer;
    const ratio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px 28px' }}>
      {/* Hidden audio element to play remote peer audio */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
        <div>
          <button
            onClick={onBackToDashboard}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-amber)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: '500',
              marginBottom: '4px',
              fontFamily: 'var(--font-sans)',
              padding: 0
            }}
          >
            ← Console
          </button>
          <h1 style={{
            fontSize: '20px',
            fontWeight: '600',
            fontFamily: 'var(--font-display)'
          }}>
            WebRTC Live Call
          </h1>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            P2P speech stream with remote-track voice clone detection
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="live-indicator-pill">
            <span
              className={`pulse-dot ${callState === 'connected' ? 'connected' : ''}`}
              style={{
                background: callState === 'connected' ? 'var(--accent-teal)' : (callState === 'waiting' ? 'var(--accent-amber)' : 'var(--text-muted)')
              }}
            />
            <span style={{ textTransform: 'uppercase' }}>
              {callState === 'connected' ? `IN CALL ${formatDuration(callDuration)}` : (callState === 'waiting' ? 'WAITING' : callState)}
            </span>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {roomId}
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      <AlertBanner
        call={{
          call_id: roomId,
          caller_name: `WebRTC Peer (${roomId})`,
          latest_risk_score: liveScore,
          alert: isAlert
        }}
        onBlock={() => alert(`[FORMANT] Call ${roomId} intercepted. Authorization revoked.`)}
      />

      <div className="webrtc-container">
        {/* Left Column: Call Connection Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Room Config */}
          <div className="glass-panel" style={{ padding: '16px' }}>
            <h3 className="panel-title" style={{ fontSize: '13px', marginBottom: '10px' }}>
              Room Setup
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', fontFamily: 'var(--font-sans)' }}>
                  Room ID
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={roomId}
                    disabled={callState === 'connected' || callState === 'waiting'}
                    onChange={(e) => setRoomId(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'var(--bg-base)',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: '4px',
                      padding: '7px 10px',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  <button
                    onClick={generateRandomRoom}
                    disabled={callState === 'connected' || callState === 'waiting'}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: '4px',
                      padding: '7px 10px',
                      color: 'var(--text-muted)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)'
                    }}
                  >
                    Random
                  </button>
                </div>
              </div>

              {/* Invite Link */}
              <button
                onClick={copyRoomLink}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  color: 'var(--text-muted)',
                  borderRadius: '4px',
                  padding: '8px 12px',
                  fontSize: '11px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  fontFamily: 'var(--font-sans)'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{copiedLink ? '✓ Copied!' : 'Copy Invite Link'}</span>
              </button>

              {/* Call Action */}
              {callState === 'idle' || callState === 'ended' ? (
                <button
                  onClick={startCall}
                  className="btn-sim"
                  style={{
                    background: 'var(--accent-amber)',
                    color: 'var(--bg-base)',
                    padding: '10px',
                    fontSize: '13px',
                    fontWeight: '600',
                    border: 'none',
                    marginTop: '4px'
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <span>Connect & Join</span>
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <button
                    onClick={toggleMute}
                    style={{
                      flex: 1,
                      background: isMuted ? 'var(--accent-amber)' : 'transparent',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: '4px',
                      padding: '8px',
                      color: isMuted ? 'var(--bg-base)' : 'var(--text-primary)',
                      fontWeight: '500',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)'
                    }}
                  >
                    {isMuted ? '🔇 Unmute' : '🎤 Mute'}
                  </button>

                  <button
                    onClick={endCall}
                    style={{
                      flex: 1,
                      background: 'var(--accent-red)',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '8px',
                      color: 'white',
                      fontWeight: '600',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)'
                    }}
                  >
                    End Call
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Connection Telemetry */}
          <div className="glass-panel" style={{ padding: '16px' }}>
            <h3 className="panel-title" style={{ fontSize: '13px', marginBottom: '10px' }}>
              Connection
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>State</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{callState}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Peers</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{peerCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Captured</span>
                <span style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{capturedPackets} chunks</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Encryption</span>
                <span style={{ color: 'var(--accent-teal)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>SRTP / DTLS</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Forensic Scoring */}
        <div className="console-deck">
          {/* Header */}
          <div className={`glass-panel ${callState === 'connected' ? (isAlert ? 'panel-glow-red' : 'panel-glow-amber') : ''}`} style={{
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  fontFamily: 'var(--font-display)'
                }}>
                  Remote Speaker Monitor
                </h2>
                <span className={`score-badge-mini ${isAlert ? 'badge-danger' : (liveScore >= 40 ? 'badge-warn' : 'badge-safe')}`}>
                  {callState === 'connected' ? 'LIVE' : 'STANDBY'}
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                Incoming remote audio track · sliding windows every 1.5s
              </p>
            </div>

            <div className="waveform-container" title="Audio Activity">
              {[0.2, 0.9, 0.4, 1.0, 0.6, 0.8, 0.3, 0.7, 0.5, 0.85].map((scale, i) => (
                <div
                  key={i}
                  className="wave-bar"
                  style={{
                    height: `${scale * (callState === 'connected' ? 100 : 20)}%`,
                    background: isAlert ? 'var(--accent-red)' : 'var(--accent-amber)',
                    opacity: callState === 'connected' ? 1 : 0.2
                  }}
                />
              ))}
            </div>
          </div>

          {/* Gauge + Timeline */}
          <div className="inspection-grid">
            <RiskGauge
              score={liveScore}
              alertThreshold={70}
            />

            <RiskTimelineChart
              history={scoreHistory}
              threshold={70}
            />
          </div>

          {/* Telemetry */}
          <div className="glass-panel" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 className="panel-title">Remote Speaker Telemetry</h3>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                16 kHz · 1.5s chunks
              </span>
            </div>

            <AcousticTelemetry
              telemetry={latestTelemetry}
              isStreaming={callState === 'connected'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
