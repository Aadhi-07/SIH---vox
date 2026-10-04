import React, { useState, useEffect } from 'react';

import { BACKEND_HTTP_URL } from '../config';

const API_BASE = BACKEND_HTTP_URL;
export default function I4CDossierModal({ callId, onClose }) {
  const [dossier, setDossier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!callId) return;
    setLoading(true);
    fetch(`${API_BASE}/calls/${callId}/dossier`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load dossier from backend');
        return res.json();
      })
      .then((data) => {
        setDossier(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [callId]);

  const handleDownloadJson = () => {
    if (!dossier) return;
    const blob = new Blob([JSON.stringify(dossier, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dossier.incident_id.replace(/\//g, '_')}_Forensic_Dossier.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenPrintable = () => {
    window.open(`${API_BASE}/calls/${callId}/dossier/html`, '_blank');
  };

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
          maxWidth: '780px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: '6px',
          padding: '24px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-hairline)', paddingBottom: '14px', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>🇮🇳</span>
              <span style={{ fontSize: '10px', fontWeight: '600', letterSpacing: '0.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>
                MHA · Indian Cybercrime Coordination Centre (I4C)
              </span>
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginTop: '4px'
            }}>
              Forensic Evidence Dossier
            </h2>
            <div style={{ fontSize: '10px', color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
              1930 / cybercrime.gov.in
            </div>
          </div>
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
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Compiling forensic evidence…
          </div>
        ) : error ? (
          <div style={{ color: 'var(--accent-red)', padding: '16px', textAlign: 'center', fontSize: '12px' }}>
            Error: {error}
          </div>
        ) : dossier ? (
          <div>
            {/* Verdict Summary */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: dossier.forensic_classification.verdict.includes('SYNTHETIC')
                  ? 'rgba(229, 72, 77, 0.06)'
                  : 'rgba(79, 209, 174, 0.06)',
                border: dossier.forensic_classification.verdict.includes('SYNTHETIC')
                  ? '1px solid rgba(229, 72, 77, 0.25)'
                  : '1px solid rgba(79, 209, 174, 0.2)',
                borderRadius: '4px',
                padding: '14px 18px',
                marginBottom: '18px'
              }}
            >
              <div>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '500', fontFamily: 'var(--font-sans)' }}>
                  Classification
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: dossier.forensic_classification.verdict.includes('SYNTHETIC') ? 'var(--accent-red)' : 'var(--accent-teal)',
                    marginTop: '2px'
                  }}
                >
                  {dossier.forensic_classification.verdict}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Ref: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{dossier.incident_id}</span> · {dossier.timestamp_ist}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>Risk</div>
                <div
                  style={{
                    fontSize: '22px',
                    fontWeight: '600',
                    color: dossier.forensic_classification.verdict.includes('SYNTHETIC') ? 'var(--accent-red)' : 'var(--accent-teal)',
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  {dossier.forensic_classification.voice_clone_risk_score}
                </div>
              </div>
            </div>

            {/* Target Info Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '18px' }}>
              {[
                { label: 'Call ID', value: dossier.target_call.call_id, mono: true },
                { label: 'Caller', value: dossier.target_call.caller_alias },
                { label: 'Channel', value: dossier.target_call.department_channel },
                { label: 'HITL Status', value: dossier.target_call.current_status, color: 'var(--accent-amber)' }
              ].map((item, i) => (
                <div key={i} style={{ background: 'var(--bg-base)', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-hairline)' }}>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>{item.label}</div>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: item.color || 'var(--text-primary)',
                    marginTop: '2px',
                    fontFamily: item.mono ? 'var(--font-mono)' : 'var(--font-sans)'
                  }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Acoustic Evidence Table */}
            <div style={{ marginBottom: '18px' }}>
              <h4 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                marginBottom: '8px'
              }}>
                Acoustic Telemetry
              </h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                    <th style={{ padding: '7px 10px', color: 'var(--text-muted)', fontWeight: '500', fontFamily: 'var(--font-sans)' }}>Metric</th>
                    <th style={{ padding: '7px 10px', color: 'var(--text-muted)', fontWeight: '500', fontFamily: 'var(--font-sans)' }}>Measured</th>
                    <th style={{ padding: '7px 10px', color: 'var(--text-muted)', fontWeight: '500', fontFamily: 'var(--font-sans)' }}>Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}>F0 Mean (Pitch)</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
                      {dossier.acoustic_indicators.pitch_f0_mean_hz.toFixed(1)} Hz (σ {dossier.acoustic_indicators.pitch_f0_std_hz.toFixed(1)})
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-muted)' }}>100–240 Hz (σ &gt; 28)</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}>Micro-Jitter</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
                      {dossier.acoustic_indicators.parselmouth_jitter_local.toFixed(4)}
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-muted)' }}>0.0080–0.0150</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}>Shimmer</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
                      {dossier.acoustic_indicators.parselmouth_shimmer_local.toFixed(4)}
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-muted)' }}>0.1200–0.1800</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-primary)' }}>Spectral Flatness</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
                      {dossier.acoustic_indicators.librosa_spectral_flatness.toFixed(4)}
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border-hairline)', color: 'var(--text-muted)' }}>&lt; 0.0050</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* SHA-256 */}
            <div style={{ background: 'var(--bg-base)', padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-hairline)', marginBottom: '18px' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-sans)' }}>SHA-256 Audio Fingerprint</div>
              <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: '2px' }}>
                {dossier.forensic_classification.sha256_audio_fingerprint}
              </div>
            </div>

            {/* Statutory Directives */}
            <div style={{ background: 'var(--bg-base)', padding: '12px', borderRadius: '4px', border: '1px solid var(--border-hairline)', marginBottom: '18px' }}>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--accent-red)',
                textTransform: 'uppercase',
                marginBottom: '6px'
              }}>
                Statutory Enforcement Directives
              </div>
              <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                {dossier.statutory_sanctions.enforcement_directives.map((dir, i) => (
                  <li key={i}>{dir}</li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-hairline)', paddingTop: '14px' }}>
              <button
                onClick={handleDownloadJson}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  color: 'var(--text-primary)',
                  padding: '7px 14px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)'
                }}
              >
                📥 JSON
              </button>
              <button
                onClick={handleOpenPrintable}
                style={{
                  background: 'var(--accent-amber)',
                  border: 'none',
                  color: 'var(--bg-base)',
                  padding: '7px 14px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontFamily: 'var(--font-sans)'
                }}
              >
                🖨️ Print Report
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
