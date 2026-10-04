import React, { useState, useEffect, useRef, useCallback } from 'react';

import { BACKEND_WS_URL } from '../config';

const WS_BASE = BACKEND_WS_URL;
export default function LiveMicModal({ onClose }) {
  const [isRecording, setIsRecording] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [isAlert, setIsAlert] = useState(false);
  const [isSpeech, setIsSpeech] = useState(false);
  const [telemetry, setTelemetry] = useState({});
  const [packetsSent, setPacketsSent] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);

  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const wsRef = useRef(null);
  const scriptNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);

  // Draw real waveform from AnalyserNode
  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Draw waveform bars (frequency bins -> bar heights)
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);

      const barCount = 48;
      const barWidth = Math.max(1.5, (w / barCount) - 1.5);
      const gap = (w - barCount * barWidth) / (barCount - 1);

      for (let i = 0; i < barCount; i++) {
        // Sample from frequency data
        const dataIndex = Math.floor((i / barCount) * freqData.length);
        const value = freqData[dataIndex] / 255;
        const barHeight = Math.max(2, value * h * 0.9);

        const x = i * (barWidth + gap);
        const y = (h - barHeight) / 2;

        // Color based on alert state
        const alpha = 0.4 + value * 0.6;
        if (isAlert) {
          ctx.fillStyle = `rgba(229, 72, 77, ${alpha})`;
        } else {
          ctx.fillStyle = `rgba(79, 209, 174, ${alpha})`;
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }
    };

    draw();
  }, [isAlert]);

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

  const startMicTest = async () => {
    setErrorMsg(null);
    try {
      // 1. Get raw microphone stream without destructive browser audio processing
      // Disabling echoCancellation, noiseSuppression, and autoGainControl preserves natural acoustic micro-jitter and vocal tract textures
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      streamRef.current = stream;

      // 2. Connect WebSocket
      const callId = `call-live-mic-${Date.now()}`;
      const ws = new WebSocket(`${WS_BASE}/ws/call/${callId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsRecording(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.risk_score !== undefined) {
            setLiveScore(data.risk_score);
            if (data.confidence !== undefined) setConfidence(data.confidence);
            setIsAlert(Boolean(data.alert));
            setIsSpeech(data.is_speech !== undefined ? Boolean(data.is_speech) : true);
            if (data.telemetry) setTelemetry(data.telemetry);
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket error:', e);
        setErrorMsg('WebSocket connection to backend failed.');
      };

      // 3. Audio Context & PCM Chunking + AnalyserNode for visualization
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // Create analyser for waveform visualization
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Start waveform drawing
      drawWaveform();

      // Process chunks for scoring with explicit 16kHz resampling
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const actualRate = e.inputBuffer.sampleRate || audioCtx.sampleRate || 16000;
        const resampled = downsampleBuffer(inputData, actualRate, 16000);

        const pcm16 = new Int16Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm16.buffer);
        setPacketsSent((prev) => prev + 1);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

    } catch (err) {
      console.error('Microphone access failed:', err);
      setErrorMsg(`Microphone error: ${err.message}. Please allow microphone permissions.`);
    }
  };

  const stopMicTest = () => {
    setIsRecording(false);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (scriptNodeRef.current) {
      try { scriptNodeRef.current.disconnect(); } catch {}
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
    }
  };

  useEffect(() => {
    startMicTest();
    return () => {
      stopMicTest();
    };
  }, []);

  const scoreColorRaw = isAlert 
    ? '#E5484D' 
    : (!isSpeech && liveScore === 0 
        ? '#8E8E93' 
        : (liveScore > 40 ? '#E8A855' : '#4FD1AE'));

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: '6px',
          padding: '24px',
          textAlign: 'center'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '16px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '16px' }}>🎙️</span>
            Live Voice Verifier
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              color: 'var(--text-muted)',
              borderRadius: '4px',
              width: '28px',
              height: '28px',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        {errorMsg ? (
          <div style={{
            color: 'var(--accent-red)',
            padding: '16px',
            background: 'rgba(229, 72, 77, 0.06)',
            border: '1px solid rgba(229, 72, 77, 0.2)',
            borderRadius: '4px',
            marginBottom: '16px',
            fontSize: '12px'
          }}>
            {errorMsg}
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Speak naturally into your microphone. Formant extracts acoustic micro-jitter and spectral flatness in real time.
            </p>

            {/* Live Waveform Visualization (real audio data) */}
            <div style={{
              background: 'var(--bg-base)',
              borderRadius: '4px',
              padding: '12px',
              marginBottom: '16px',
              border: '1px solid var(--border-hairline)'
            }}>
              <canvas
                ref={canvasRef}
                width={460}
                height={80}
                style={{ width: '100%', height: '80px', display: 'block' }}
              />
            </div>

            {/* Risk Score Circle */}
            <div style={{ margin: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  border: `2px solid ${scoreColorRaw}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  transition: 'border-color 0.3s ease'
                }}
              >
                <div style={{
                  fontSize: '28px',
                  fontWeight: '600',
                  color: scoreColorRaw,
                  fontFamily: 'var(--font-mono)'
                }}>
                  {liveScore.toFixed(1)}%
                </div>
                <div style={{
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontFamily: 'var(--font-sans)'
                }}>
                  Risk Score
                </div>
              </div>

              <div style={{ marginTop: '12px' }}>
                <span
                  className={isAlert ? 'badge-danger' : (!isSpeech && liveScore === 0 ? 'badge-muted' : 'badge-safe')}
                  style={{
                    padding: '3px 12px',
                    borderRadius: '3px',
                    fontSize: '10px',
                    fontWeight: '600',
                    fontFamily: 'var(--font-sans)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: (!isSpeech && liveScore === 0) ? 'rgba(255, 255, 255, 0.08)' : undefined,
                    color: (!isSpeech && liveScore === 0) ? 'var(--text-muted)' : undefined
                  }}
                >
                  {isAlert ? 'SYNTHETIC DETECTED' : (!isSpeech && liveScore === 0 ? 'LISTENING (AWAITING SPEECH)' : 'GENUINE VOICE')}
                </span>
              </div>
            </div>

            {/* Telemetry Snapshot */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              margin: '16px 0',
              background: 'var(--bg-base)',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid var(--border-hairline)'
            }}>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>Confidence</div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {Math.round(confidence)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>Pitch (F0)</div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {telemetry.pitch_f0_mean ? `${Math.round(telemetry.pitch_f0_mean)} Hz` : '--'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>Micro-Jitter</div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {telemetry.jitter_local !== undefined ? telemetry.jitter_local.toFixed(4) : '--'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Status: {isRecording ? (isSpeech ? '🎙️ Speech Detected' : '👂 Listening (Silence/Pause)') : 'Connecting...'} · Packets: {packetsSent} · Window: 2.0s
            </div>
          </div>
        )}

        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              color: 'var(--text-primary)',
              padding: '8px 20px',
              borderRadius: '4px',
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
