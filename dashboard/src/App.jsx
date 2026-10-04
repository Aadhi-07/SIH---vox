import React, { useState, useEffect, useRef } from 'react';
import CallList from './components/CallList';
import RiskGauge from './components/RiskGauge';
import RiskTimelineChart from './components/RiskTimelineChart';
import AlertBanner from './components/AlertBanner';
import AcousticTelemetry from './components/AcousticTelemetry';
import WebRTCCall from './components/WebRTCCall';
import SIHScenarioBar from './components/SIHScenarioBar';
import I4CDossierModal from './components/I4CDossierModal';
import LiveMicModal from './components/LiveMicModal';

import { BACKEND_HTTP_URL, BACKEND_WS_URL, BACKEND_LABEL } from './config';

const API_BASE = BACKEND_HTTP_URL;
const WS_URL = `${BACKEND_WS_URL}/ws/dashboard`;
export default function App() {
  const [currentView, setCurrentView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'call' || window.location.pathname.startsWith('/call') || window.location.hash.includes('call')) {
      return 'webrtc_call';
    }
    return 'dashboard';
  });

  const [calls, setCalls] = useState([]);
  const [selectedCallId, setSelectedCallId] = useState('call-digital-arrest');
  const [wsConnected, setWsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [blockedCalls, setBlockedCalls] = useState(new Set());
  const [showDossierModal, setShowDossierModal] = useState(false);
  const [dossierCallId, setDossierCallId] = useState('call-digital-arrest');
  const [showLiveMicModal, setShowLiveMicModal] = useState(false);
  const [activeScenario, setActiveScenario] = useState({
    id: 'sih-digital-arrest',
    callId: 'call-digital-arrest',
    title: 'Digital Arrest Scam',
    tag: 'CBI / Police Clone',
    threat: 'Extortion under Sec 102 CrPC',
    transcript: 'Attention. This is Inspector Rajesh Sharma calling from Delhi Cyber Crime Cell. A formal FIR has been registered against your national identity for illegal money laundering. Under section 102 CrPC, you are placed under digital arrest immediately...',
    badgeColor: '#E5484D'
  });
  const [stats, setStats] = useState({
    alerts_raised: 3,
    confirmed_blocks: 0,
    dismissed_false_positives: 0
  });
  const wsRef = useRef(null);

  // Fetch stats via REST
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.warn('Backend stats polling error:', err);
    }
  };

  // Fetch calls snapshot via REST
  const fetchCalls = async () => {
    try {
      const res = await fetch(`${API_BASE}/calls`);
      if (res.ok) {
        const data = await res.json();
        setCalls(data);
        if (!selectedCallId && data.length > 0) {
          setSelectedCallId(data[0].call_id);
        }
      }
    } catch (err) {
      console.warn('Backend REST polling error:', err);
    }
  };

  // Fetch full details for selected call
  const [selectedCallDetail, setSelectedCallDetail] = useState(null);
  const fetchSelectedCallDetail = async (cid) => {
    if (!cid) return;
    try {
      const res = await fetch(`${API_BASE}/calls/${cid}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedCallDetail(data);
      }
    } catch (err) {
      console.warn('Error fetching call detail:', err);
    }
  };

  function jsonParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  // Connect to Dashboard WebSocket
  useEffect(() => {
    fetchCalls();
    fetchStats();

    const connectWs = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = jsonParse(event.data);
            if (!data) return;

            if (data.type === 'SNAPSHOT') {
              if (Array.isArray(data.calls)) setCalls(data.calls);
              if (data.stats) setStats(data.stats);
            } else if (data.type === 'CALL_UPDATE') {
              // Update call in list
              setCalls((prev) => {
                const idx = prev.findIndex((c) => c.call_id === data.call_id);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    latest_risk_score: data.risk_score,
                    latest_confidence: data.confidence,
                    confidence: data.confidence,
                    alert: data.alert,
                    status: data.status || updated[idx].status,
                    last_updated: data.timestamp,
                    ai_verdict: data.ai_verdict || updated[idx].ai_verdict,
                    human_override: data.human_override || updated[idx].human_override
                  };
                  return updated;
                } else {
                  return [{
                    call_id: data.call_id,
                    caller_name: data.caller_name || `Live Call (${data.call_id})`,
                    department: 'Incoming Stream',
                    status: data.status || 'streaming',
                    latest_risk_score: data.risk_score,
                    latest_confidence: data.confidence,
                    confidence: data.confidence,
                    alert: data.alert,
                    last_updated: data.timestamp
                  }, ...prev];
                }
              });

              // If this is the selected call, update history
              setSelectedCallDetail((curr) => {
                if (!curr || curr.call_id !== data.call_id) return curr;
                const newHistory = [...(curr.history || [])];
                newHistory.push({
                  relative_sec: Math.round(((data.timestamp - (curr.start_time || data.timestamp))) * 10) / 10,
                  risk_score: data.risk_score,
                  confidence: data.confidence,
                  alert: data.alert
                });
                return {
                  ...curr,
                  latest_risk_score: data.risk_score,
                  latest_confidence: data.confidence,
                  confidence: data.confidence,
                  alert: data.alert,
                  status: data.status || curr.status,
                  history: newHistory,
                  latest_telemetry: data.telemetry,
                  ai_verdict: data.ai_verdict || curr.ai_verdict,
                  human_override: data.human_override || curr.human_override
                };
              });
            } else if (data.type === 'CALL_REVIEWED') {
              if (data.stats) setStats(data.stats);
              setCalls((prev) =>
                prev.map((c) =>
                  c.call_id === data.call_id
                    ? { ...c, status: data.status, alert: data.alert }
                    : c
                )
              );
              setSelectedCallDetail((curr) =>
                curr && curr.call_id === data.call_id
                  ? { ...curr, status: data.status, alert: data.alert }
                  : curr
              );
            } else if (data.type === 'CALL_ENDED') {
              setCalls((prev) =>
                prev.map((c) => (c.call_id === data.call_id ? { ...c, status: data.status || 'ended' } : c))
              );
              setSelectedCallDetail((curr) =>
                curr && curr.call_id === data.call_id
                  ? { ...curr, status: data.status || 'ended' }
                  : curr
              );
            }
          } catch (e) {
            console.error('WS parse error:', e);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          // Auto reconnect after 3s
          setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        console.warn('WS Init failed:', err);
      }
    };

    connectWs();
    const interval = setInterval(() => {
      fetchCalls();
      fetchStats();
    }, 3000);

    return () => {
      clearInterval(interval);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Update selected call detail on ID change
  useEffect(() => {
    fetchSelectedCallDetail(selectedCallId);
  }, [selectedCallId]);



  // Trigger test simulation directly from dashboard
  const handleTriggerSimulation = async (type) => {
    setIsSimulating(true);
    const simCallId = type === 'bonafide' ? 'call-cxo-auth' : 'call-fraud-wire';
    setSelectedCallId(simCallId);

    try {
      // Reset call history first
      await fetch(`${API_BASE}/calls/${simCallId}/reset`, { method: 'POST' });
      // Trigger simulation
      await fetch(`${API_BASE}/demo/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_id: simCallId,
          call_type: type,
          pace_delay_sec: 0.4
        })
      });
      // Refresh
      setTimeout(() => {
        fetchCalls();
        fetchSelectedCallDetail(simCallId);
      }, 500);
    } catch (err) {
      console.error('Failed to trigger simulation:', err);
    } finally {
      setTimeout(() => setIsSimulating(false), 2000);
    }
  };

  // Trigger SIH Indian Cybercrime demonstration scenario
  const handleSelectScenario = async (scenario) => {
    setSelectedCallId(scenario.callId);
    setDossierCallId(scenario.callId);
    setActiveScenario(scenario);
    setIsSimulating(true);

    try {
      await fetch(`${API_BASE}/sih/simulate/${scenario.id}`, { method: 'POST' });
      setTimeout(() => {
        fetchCalls();
        fetchSelectedCallDetail(scenario.callId);
      }, 500);
    } catch (err) {
      console.error('Failed to trigger SIH scenario:', err);
    } finally {
      setTimeout(() => setIsSimulating(false), 2000);
    }
  };

  // Upload and stream custom audio file (.wav, .mp3)
  const handleUploadAudio = async (file) => {
    if (!file) return;
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/calls/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Upload failed');
      }

      const data = await res.json();
      const newCallId = data.call_id;

      // Immediately switch view to watch this call's live risk score
      setSelectedCallId(newCallId);

      // Prepopulate call detail so UI responds instantaneously
      setSelectedCallDetail({
        call_id: newCallId,
        caller_name: `Uploaded: ${file.name}`,
        department: 'Uploaded Audio File',
        status: 'streaming',
        start_time: Date.now() / 1000,
        last_updated: Date.now() / 1000,
        latest_risk_score: 0.0,
        max_risk_score: 0.0,
        alert: false,
        packets_processed: 0,
        history: [],
        latest_telemetry: {}
      });

      // Add to calls list state if not already there
      setCalls((prev) => [
        {
          call_id: newCallId,
          caller_name: `Uploaded: ${file.name}`,
          department: 'Uploaded Audio File',
          status: 'streaming',
          latest_risk_score: 0.0,
          max_risk_score: 0.0,
          alert: false,
          last_updated: Date.now() / 1000
        },
        ...prev.filter((c) => c.call_id !== newCallId)
      ]);

      // Re-sync with backend calls list
      setTimeout(() => {
        fetchCalls();
      }, 600);
    } catch (err) {
      console.error('Failed to upload audio file:', err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleReviewCall = async (callId, action) => {
    try {
      const res = await fetch(`${API_BASE}/calls/${callId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.stats) setStats(data.stats);
        if (action === 'confirm_block') {
          setBlockedCalls((prev) => new Set([...prev, callId]));
        } else {
          setBlockedCalls((prev) => {
            const next = new Set(prev);
            next.delete(callId);
            return next;
          });
        }
        setCalls((prev) =>
          prev.map((c) =>
            c.call_id === callId
              ? { ...c, status: data.call_status, alert: data.call_status === 'BLOCKED' }
              : c
          )
        );
        setSelectedCallDetail((curr) =>
          curr && curr.call_id === callId
            ? { ...curr, status: data.call_status, alert: data.call_status === 'BLOCKED' }
            : curr
        );
        await fetchCalls();
        await fetchSelectedCallDetail(callId);
      }
    } catch (err) {
      console.error('Failed to review call:', err);
    }
  };

  const handleConfirmBlock = (callId) => {
    handleReviewCall(callId, 'confirm_block');
  };

  const handleDismissFalsePositive = (callId) => {
    handleReviewCall(callId, 'dismiss');
  };

  // Find active selected call object
  const activeCall = selectedCallDetail || calls.find((c) => c.call_id === selectedCallId) || {
    call_id: selectedCallId || 'call-0',
    caller_name: 'Select a Call',
    latest_risk_score: 0,
    alert: false,
    history: []
  };

  const isCurrentCallBlocked = activeCall.status === 'BLOCKED' || blockedCalls.has(activeCall.call_id);
  const isCurrentCallPending = activeCall.status === 'PENDING_REVIEW';

  // Determine glow class for the active call metadata panel
  const getGlowClass = () => {
    if (activeCall.alert || isCurrentCallBlocked) return 'panel-glow-red';
    if (activeCall.status === 'streaming') return 'panel-glow-amber';
    if (activeCall.status === 'CLEARED') return 'panel-glow-teal';
    return '';
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top Navigation / Brand Bar ── */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15161C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </div>
          <div>
            <span className="brand-title">Formant</span>
          </div>


          {/* View Switcher */}
          <div style={{ display: 'flex', gap: '4px', marginLeft: '20px' }}>
            <button
              onClick={() => setCurrentView('dashboard')}
              style={{
                background: currentView === 'dashboard' ? 'var(--bg-surface-raised)' : 'transparent',
                border: currentView === 'dashboard' ? '1px solid var(--border-hairline)' : '1px solid transparent',
                color: currentView === 'dashboard' ? 'var(--text-primary)' : 'var(--text-muted)',
                padding: '5px 12px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '500',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)'
              }}
            >
              Console
            </button>
            <button
              onClick={() => setCurrentView('webrtc_call')}
              style={{
                background: currentView === 'webrtc_call' ? 'var(--bg-surface-raised)' : 'transparent',
                border: currentView === 'webrtc_call' ? '1px solid var(--border-hairline)' : '1px solid transparent',
                color: currentView === 'webrtc_call' ? 'var(--text-primary)' : 'var(--text-muted)',
                padding: '5px 12px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '500',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <span>Live Call</span>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-amber)' }} />
            </button>
          </div>
        </div>

        <div className="header-status-group">
          {/* ── Telemetry Strip (replaces colored pills) ── */}
          <div className="telemetry-strip" id="stats-header-counter">
            <span>Alerts <span className="ts-value" style={{ color: 'var(--accent-amber)' }}>{stats.alerts_raised}</span></span>
            <div className="ts-divider" />
            <span>Blocks <span className="ts-value" style={{ color: 'var(--accent-red)' }}>{stats.confirmed_blocks}</span></span>
            <div className="ts-divider" />
            <span>Dismissed <span className="ts-value" style={{ color: 'var(--accent-teal)' }}>{stats.dismissed_false_positives}</span></span>
          </div>

          {isCurrentCallBlocked && (
            <span className="badge-danger score-badge-mini" style={{ fontSize: '10px', fontFamily: 'var(--font-sans)', fontWeight: '600' }}>
              BLOCKED
            </span>
          )}

          {isCurrentCallPending && !isCurrentCallBlocked && (
            <span className="badge-warn score-badge-mini" style={{ fontSize: '10px', fontFamily: 'var(--font-sans)', fontWeight: '600' }}>
              PENDING REVIEW
            </span>
          )}

          <div className="live-indicator-pill">
            <span className={`pulse-dot ${wsConnected ? 'connected' : ''}`} style={{ background: wsConnected ? 'var(--accent-teal)' : 'var(--accent-red)' }} />
            <span>{wsConnected ? 'LIVE' : 'CONNECTING'}</span>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {BACKEND_LABEL}
          </div>
        </div>
      </header>

      {/* SIH Scenario Bar */}
      {currentView === 'dashboard' && (
        <SIHScenarioBar
          selectedCallId={selectedCallId}
          onSelectScenario={handleSelectScenario}
          onStartLiveMic={() => setShowLiveMicModal(true)}
          onOpenDossier={(cid) => {
            setDossierCallId(cid || selectedCallId);
            setShowDossierModal(true);
          }}
          isSimulating={isSimulating}
        />
      )}

      {/* Main Content */}
      {currentView === 'webrtc_call' ? (
        <WebRTCCall onBackToDashboard={() => setCurrentView('dashboard')} />
      ) : (
      <main className="dashboard-container">
        {/* Left Column: Call Explorer & Simulators */}
        <CallList
          calls={calls}
          selectedCallId={selectedCallId}
          onSelectCall={(id) => {
            setSelectedCallId(id);
            setDossierCallId(id);
          }}
          onTriggerSimulation={handleTriggerSimulation}
          onUploadAudio={handleUploadAudio}
          isSimulating={isSimulating}
          isUploading={isUploading}
        />

        {/* Right Column: Inspection Console */}
        <div className="console-deck">
          {/* Alert Banner */}
          <AlertBanner
            call={activeCall}
            onConfirmBlock={handleConfirmBlock}
            onDismiss={handleDismissFalsePositive}
            onBlock={handleConfirmBlock}
            onOpenDossier={(cid) => {
              setDossierCallId(cid || selectedCallId);
              setShowDossierModal(true);
            }}
          />

          {/* AI Agent Verdict */}
          {activeCall?.ai_verdict && (
            <div className="glass-panel" style={{ padding: '12px 16px', borderLeft: '3px solid var(--accent-teal)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--accent-teal)', fontWeight: '600', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
                  AI Agent Verdict: {activeCall.ai_verdict.action.replace(/_/g, ' ')}
                </span>
                {activeCall.human_override && (
                  <span className="badge-warn score-badge-mini" style={{ fontSize: '9px' }}>
                    HUMAN OVERRIDE: {activeCall.human_override.replace(/_/g, ' ').toUpperCase()}
                  </span>
                )}
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                {activeCall.ai_verdict.reasoning}
              </p>
            </div>
          )}

          {/* Scenario Brief */}
          {activeScenario && (
            <div className="glass-panel" style={{
              padding: '12px 16px',
              borderLeft: `3px solid ${activeScenario.badgeColor || 'var(--accent-amber)'}`
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    color: activeScenario.badgeColor || 'var(--accent-amber)',
                    fontWeight: '600'
                  }}>
                    {activeScenario.title}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    · {activeScenario.threat}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    1930 / I4C
                  </span>
                  <button
                    onClick={() => {
                      setDossierCallId(selectedCallId);
                      setShowDossierModal(true);
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-hairline)',
                      color: 'var(--text-muted)',
                      fontSize: '9px',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontWeight: '500',
                      fontFamily: 'var(--font-sans)'
                    }}
                  >
                    📄 Dossier
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: '1.45' }}>
                "{activeScenario.transcript}"
              </p>
            </div>
          )}

          {/* Call Metadata Card — THE one card that gets a glow */}
          <div className={`glass-panel ${getGlowClass()}`} style={{
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h1 style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  fontFamily: 'var(--font-display)'
                }}>
                  {activeCall.caller_name || activeCall.call_id}
                </h1>
                <span className={`score-badge-mini ${activeCall.status === 'BLOCKED' ? 'badge-danger' : (activeCall.status === 'PENDING_REVIEW' ? 'badge-warn' : (activeCall.status === 'CLEARED' ? 'badge-safe' : (activeCall.alert ? 'badge-danger' : 'badge-safe')))}`}>
                  {activeCall.status === 'BLOCKED'
                    ? 'BLOCKED'
                    : (activeCall.status === 'PENDING_REVIEW'
                        ? 'PENDING REVIEW'
                        : (activeCall.status === 'CLEARED'
                            ? 'CLEARED'
                            : (activeCall.status === 'streaming'
                                ? 'LIVE'
                                : 'ARCHIVE')))}
                </span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{activeCall.call_id}</span>
                <span style={{ margin: '0 6px', opacity: 0.3 }}>·</span>
                {activeCall.department || 'Telephony'}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                id="btn-meta-dossier"
                onClick={() => {
                  setDossierCallId(activeCall.call_id);
                  setShowDossierModal(true);
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  color: 'var(--text-muted)',
                  padding: '5px 10px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontFamily: 'var(--font-sans)'
                }}
                title="Export I4C evidence dossier"
              >
                📄 Dossier
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  Audio:
                </span>
                <div className="waveform-container" title="Voice Activity">
                  {[0.2, 0.8, 0.4, 1.0, 0.6, 0.9, 0.3, 0.7, 0.5, 0.85].map((scale, i) => (
                    <div
                      key={i}
                      className="wave-bar"
                      style={{
                        height: `${scale * (activeCall.status === 'streaming' ? 100 : 20)}%`,
                        background: activeCall.alert ? 'var(--accent-red)' : 'var(--accent-amber)',
                        opacity: activeCall.status === 'streaming' ? 1 : 0.2
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Primary Inspection Grid: Gauge + Timeline */}
          <div className="inspection-grid">
            <RiskGauge
              score={activeCall.latest_risk_score || 0}
              confidence={activeCall.confidence ?? activeCall.latest_confidence}
              alertThreshold={70}
            />

            <RiskTimelineChart
              history={activeCall.history || []}
              threshold={70}
            />
          </div>

          {/* Acoustic Telemetry */}
          <div className="glass-panel" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 className="panel-title">Acoustic Telemetry</h3>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                16 kHz · 2.0s · 0.5s hop
              </span>
            </div>

            <AcousticTelemetry
              telemetry={activeCall.latest_telemetry || {}}
              isStreaming={activeCall.status === 'streaming'}
            />
          </div>
        </div>
      </main>
      )}

      {/* I4C Dossier Modal */}
      {showDossierModal && (
        <I4CDossierModal
          callId={dossierCallId || selectedCallId}
          onClose={() => setShowDossierModal(false)}
        />
      )}

      {/* Live Mic Modal */}
      {showLiveMicModal && (
        <LiveMicModal
          onClose={() => {
            setShowLiveMicModal(false);
            fetchCalls();
          }}
        />
      )}
    </div>
  );
}
