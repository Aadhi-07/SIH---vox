import React, { useRef, useEffect, useState } from 'react';

export default function RiskGauge({ score = 0, confidence = null, alertThreshold = 70 }) {
  // Score range: 0 to 100
  const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));
  const confValue = confidence !== null && confidence !== undefined ? Math.round(Number(confidence)) : null;
  const prevScoreRef = useRef(clampedScore);
  const [animClass, setAnimClass] = useState('');

  // Detect threshold crossing for alert sweep animation
  useEffect(() => {
    const prev = prevScoreRef.current;
    if (prev < alertThreshold && clampedScore >= alertThreshold) {
      setAnimClass('gauge-ring-alert-enter');
      const timer = setTimeout(() => setAnimClass(''), 650);
      return () => clearTimeout(timer);
    }
    prevScoreRef.current = clampedScore;
  }, [clampedScore, alertThreshold]);

  // Gauge geometry — full arc (270 degrees)
  const radius = 82;
  const strokeWidth = 5;
  const cx = 110;
  const cy = 110;
  // Arc spans 270 degrees (from 135 deg to 405 deg)
  const startAngle = 135;
  const totalAngle = 270;
  const arcLength = (totalAngle / 360) * 2 * Math.PI * radius;

  // Score arc
  const scoreArc = arcLength * (clampedScore / 100);
  const strokeDashoffset = arcLength - scoreArc;

  // Helper to get point on arc
  const getArcPoint = (angleDeg) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  };

  // Arc path (270 deg, from 135° to 405°)
  const arcStart = getArcPoint(startAngle);
  const arcEnd = getArcPoint(startAngle + totalAngle);
  const arcPath = `M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 1 1 ${arcEnd.x} ${arcEnd.y}`;

  // Status and color determination — Formant palette
  let color = 'var(--accent-teal)';
  let statusText = 'VERIFIED GENUINE';
  let badgeClass = 'badge-safe';

  if (clampedScore >= alertThreshold) {
    color = 'var(--accent-red)';
    statusText = 'SYNTHETIC CLONE DETECTED';
    badgeClass = 'badge-danger';
  } else if (clampedScore >= 40) {
    color = 'var(--accent-amber)';
    statusText = 'ANOMALOUS';
    badgeClass = 'badge-warn';
  }

  // Tick marks at 0, 25, 50, 75, 100
  const ticks = [0, 25, 50, 75, 100];
  const tickOuter = radius + 10;
  const tickInner = radius + 3;

  return (
    <div className="gauge-card glass-panel" id="risk-gauge-container">
      <div style={{ position: 'relative', width: '220px', height: '170px' }}>
        <svg width="220" height="190" viewBox="0 0 220 190" className={animClass}>
          {/* Tick marks */}
          {ticks.map((val) => {
            const angle = startAngle + (val / 100) * totalAngle;
            const outerPt = {
              x: cx + tickOuter * Math.cos((angle * Math.PI) / 180),
              y: cy + tickOuter * Math.sin((angle * Math.PI) / 180)
            };
            const innerPt = {
              x: cx + tickInner * Math.cos((angle * Math.PI) / 180),
              y: cy + tickInner * Math.sin((angle * Math.PI) / 180)
            };
            // Label position
            const labelR = radius + 22;
            const labelPt = {
              x: cx + labelR * Math.cos((angle * Math.PI) / 180),
              y: cy + labelR * Math.sin((angle * Math.PI) / 180)
            };
            return (
              <g key={val}>
                <line
                  x1={innerPt.x} y1={innerPt.y}
                  x2={outerPt.x} y2={outerPt.y}
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeOpacity="0.5"
                />
                <text
                  x={labelPt.x} y={labelPt.y + 3}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Background Track Arc */}
          <path
            d={arcPath}
            fill="none"
            stroke="var(--border-hairline)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Alert Threshold Marker at 70% */}
          {(() => {
            const threshAngle = startAngle + (alertThreshold / 100) * totalAngle;
            const markerOuter = radius + 8;
            const markerInner = radius - 8;
            const outerPt = {
              x: cx + markerOuter * Math.cos((threshAngle * Math.PI) / 180),
              y: cy + markerOuter * Math.sin((threshAngle * Math.PI) / 180)
            };
            const innerPt = {
              x: cx + markerInner * Math.cos((threshAngle * Math.PI) / 180),
              y: cy + markerInner * Math.sin((threshAngle * Math.PI) / 180)
            };
            return (
              <line
                x1={innerPt.x} y1={innerPt.y}
                x2={outerPt.x} y2={outerPt.y}
                stroke="var(--accent-red)"
                strokeWidth="1.5"
                strokeOpacity="0.45"
                strokeDasharray="2 2"
              />
            );
          })()}

          {/* Active Risk Score Arc */}
          <path
            d={arcPath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease'
            }}
          />
        </svg>

        {/* Center Readout */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -30%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <div className="score-number-display" style={{ color }} id="live-risk-score-value">
            {clampedScore.toFixed(1)}
            <span style={{ fontSize: '20px', opacity: 0.6, fontWeight: 400 }}>%</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
        <div className={`score-status-label ${badgeClass}`} id="live-risk-status-badge">
          {statusText}
        </div>

        {confValue !== null && (
          <div
            id="live-risk-confidence-indicator"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '11px',
              fontWeight: '500',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>Confidence:</span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)',
              fontWeight: '600'
            }}>{confValue}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
