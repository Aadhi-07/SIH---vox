import React from 'react';

export default function AlertBanner({ call, onConfirmBlock, onDismiss, onBlock, onOpenDossier }) {
  if (!call) return null;

  const isBlocked = call.status === 'BLOCKED';
  const isCleared = call.status === 'CLEARED';
  const isPendingReview = call.status === 'PENDING_REVIEW' || (call.alert && !isBlocked && !isCleared);

  if (!isBlocked && !isCleared && !isPendingReview) {
    return null;
  }

  // Handle Confirmed Blocked Call
  if (isBlocked) {
    return (
      <div className="alert-banner-box blocked" id="fraud-alert-banner">
        <div className="alert-left-content">
          <div className="alert-icon-ring" style={{ background: 'rgba(229, 72, 77, 0.1)', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <div>
            <div className="alert-heading">
              BLOCKED — Verified Fraud
            </div>
            <div className="alert-body-subtext">
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{call.call_id}</span> ({call.caller_name || 'Caller'}) intercepted. Authorization revoked.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => onOpenDossier && onOpenDossier(call.call_id)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              color: 'var(--text-muted)',
              fontSize: '10px',
              padding: '4px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'var(--font-sans)'
            }}
          >
            📄 Dossier
          </button>
          <span className="badge-danger score-badge-mini" style={{ fontSize: '9px' }}>
            INTERCEPTED
          </span>
        </div>
      </div>
    );
  }

  // Handle Dismissed / False Positive Cleared Call
  if (isCleared) {
    return (
      <div className="alert-banner-box cleared" id="fraud-alert-banner">
        <div className="alert-left-content">
          <div className="alert-icon-ring" style={{ background: 'rgba(79, 209, 174, 0.1)', borderColor: 'var(--accent-teal)', color: 'var(--accent-teal)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div>
            <div className="alert-heading" style={{ color: 'var(--accent-teal)' }}>
              Dismissed — False Positive
            </div>
            <div className="alert-body-subtext">
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{call.call_id}</span> cleared by verifier. Acoustic anomalies benign.
            </div>
          </div>
        </div>
        <span className="badge-safe score-badge-mini" style={{ fontSize: '9px' }}>
          CLEARED
        </span>
      </div>
    );
  }

  // Pending Human Review
  const confidenceVal = call.confidence ?? call.latest_confidence;

  return (
    <div className="alert-banner-box" id="fraud-alert-banner">
      <div className="alert-left-content">
        <div className="alert-icon-ring">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div>
          <div className="alert-heading">
            Pending Verifier Review
          </div>
          <div className="alert-body-subtext">
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{call.call_id}</span> · Risk: <strong style={{ fontFamily: 'var(--font-mono)' }}>{call.latest_risk_score}%</strong>
            {confidenceVal !== null && confidenceVal !== undefined ? <> · Conf: <strong style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(confidenceVal)}%</strong></> : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn-confirm-block"
          id="btn-confirm-block"
          onClick={() => {
            if (onConfirmBlock) onConfirmBlock(call.call_id);
            else if (onBlock) onBlock(call.call_id);
          }}
          type="button"
          title="Verify synthetic clone fraud and block call"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <span>Block</span>
        </button>

        <button
          className="btn-dismiss-fp"
          id="btn-dismiss-fp"
          onClick={() => onDismiss && onDismiss(call.call_id)}
          type="button"
          title="Dismiss alert as false positive"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Dismiss</span>
        </button>

        <button
          id="btn-alert-open-dossier"
          onClick={() => onOpenDossier && onOpenDossier(call.call_id)}
          type="button"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text-muted)',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-sans)'
          }}
          title="View I4C evidence dossier"
        >
          📄 Dossier
        </button>
      </div>
    </div>
  );
}
