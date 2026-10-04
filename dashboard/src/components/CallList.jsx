import React, { useRef } from 'react';

export default function CallList({
  calls = [],
  selectedCallId = null,
  onSelectCall,
  onTriggerSimulation,
  onUploadAudio,
  isSimulating = false,
  isUploading = false
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onUploadAudio) {
      onUploadAudio(file);
      e.target.value = '';
    }
  };

  return (
    <div className="sidebar-panel">
      <div className="glass-panel" style={{ padding: '16px' }}>
        <div className="panel-header">
          <h2 className="panel-title">Calls</h2>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {calls.length}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
          {calls.map((call) => {
            const isSelected = call.call_id === selectedCallId;
            const score = call.latest_risk_score || 0;
            const confidenceVal = call.confidence ?? call.latest_confidence;
            const isBlocked = call.status === 'BLOCKED';
            const isPendingReview = call.status === 'PENDING_REVIEW';
            const isCleared = call.status === 'CLEARED';
            const isStreaming = call.status === 'streaming';
            const isAlert = call.alert || score >= 70;
            const badgeClass = isBlocked ? 'badge-danger' : (isPendingReview ? 'badge-warn' : (isAlert ? 'badge-danger' : (score >= 40 ? 'badge-warn' : 'badge-safe')));

            let dotColor = 'var(--text-muted)';
            if (isBlocked) dotColor = 'var(--accent-red)';
            else if (isPendingReview) dotColor = 'var(--accent-amber)';
            else if (isCleared) dotColor = 'var(--accent-teal)';
            else if (isStreaming) dotColor = 'var(--accent-teal)';

            return (
              <div
                key={call.call_id}
                id={`call-item-${call.call_id}`}
                className={`call-item-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectCall(call.call_id)}
              >
                <div className="call-item-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: dotColor
                      }}
                    />
                    <span className="call-title-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {call.caller_name || call.call_id}
                    </span>
                    {isBlocked && (
                      <span className="badge-danger score-badge-mini" style={{ fontSize: '8px', padding: '1px 4px' }}>
                        BLOCKED
                      </span>
                    )}
                    {isPendingReview && (
                      <span className="badge-warn score-badge-mini" style={{ fontSize: '8px', padding: '1px 4px' }}>
                        REVIEW
                      </span>
                    )}
                    {isCleared && (
                      <span className="badge-safe score-badge-mini" style={{ fontSize: '8px', padding: '1px 4px' }}>
                        CLEARED
                      </span>
                    )}
                  </div>
                  <span className={`score-badge-mini ${badgeClass}`}>
                    {score.toFixed(1)}%
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                  <span className="call-dept-text">{call.department || 'Telecom Gateway'}</span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {confidenceVal !== null && confidenceVal !== undefined && (
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {Math.round(confidenceVal)}%
                      </span>
                    )}
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', opacity: 0.6 }}>
                      {call.call_id}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Simulator Controls */}
      <div className="simulators-card glass-panel" id="simulator-controls-card">
        <div>
          <h3 className="panel-title" style={{ fontSize: '13px' }}>Simulators</h3>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Inject test audio or upload recorded calls
          </p>
        </div>

        <div className="sim-btn-group">
          <button
            className="btn-sim btn-sim-bonafide"
            id="btn-simulate-bonafide"
            disabled={isSimulating || isUploading}
            onClick={() => onTriggerSimulation('bonafide')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <span>Genuine Call</span>
          </button>

          <button
            className="btn-sim btn-sim-spoofed"
            id="btn-simulate-spoofed"
            disabled={isSimulating || isUploading}
            onClick={() => onTriggerSimulation('spoofed')}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
              <path d="M8.5 8.5v.01" />
              <path d="M11.5 11.5v.01" />
            </svg>
            <span>Clone Impersonation</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            accept=".wav,.mp3,audio/wav,audio/mpeg"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            className={`btn-sim btn-sim-upload ${isUploading ? 'uploading' : ''}`}
            id="btn-upload-audio"
            disabled={isSimulating || isUploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{isUploading ? 'Analyzing...' : 'Upload Audio'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
