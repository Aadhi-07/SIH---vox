import React, { useState, useRef, useEffect } from 'react';

export default function RiskTimelineChart({ history = [], threshold = 70 }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const pathRef = useRef(null);
  const prevLengthRef = useRef(0);

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 30, bottom: 30, left: 45 };

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Ensure points
  const points = history.length > 0 ? history : [
    { relative_sec: 0, risk_score: 0 },
    { relative_sec: 1, risk_score: 0 }
  ];

  // Min and max times
  const minTime = points[0]?.relative_sec || 0;
  const maxTime = Math.max(minTime + 5, points[points.length - 1]?.relative_sec || 5);
  const timeRange = Math.max(1, maxTime - minTime);

  // Coordinate mapping
  const getX = (t) => padding.left + ((t - minTime) / timeRange) * plotW;
  const getY = (s) => padding.top + plotH - (Math.min(100, Math.max(0, s)) / 100) * plotH;

  // Threshold Y
  const thresholdY = getY(threshold);

  // SVG Line path string
  let pathD = '';
  points.forEach((pt, idx) => {
    const x = getX(pt.relative_sec);
    const y = getY(pt.risk_score);
    if (idx === 0) {
      pathD += `M ${x} ${y}`;
    } else {
      pathD += ` L ${x} ${y}`;
    }
  });

  // Area path string for gradient fill
  const firstX = getX(points[0].relative_sec);
  const lastX = getX(points[points.length - 1].relative_sec);
  const baseY = getY(0);
  const areaD = `${pathD} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

  // Latest score
  const latestScore = points[points.length - 1]?.risk_score || 0;
  const isAlert = latestScore >= threshold;
  const lineColorRaw = isAlert ? '#E5484D' : (latestScore >= 40 ? '#E8A855' : '#4FD1AE');

  // Animate line drawing when new points arrive
  useEffect(() => {
    if (pathRef.current && points.length > prevLengthRef.current) {
      const pathEl = pathRef.current;
      const totalLength = pathEl.getTotalLength();
      // Animate from current position to full length
      pathEl.style.transition = 'none';
      pathEl.style.strokeDasharray = totalLength;
      pathEl.style.strokeDashoffset = totalLength * 0.02; // slight reveal
      requestAnimationFrame(() => {
        pathEl.style.transition = 'stroke-dashoffset 0.3s ease-out';
        pathEl.style.strokeDashoffset = '0';
      });
    }
    prevLengthRef.current = points.length;
  }, [points.length]);

  return (
    <div className="chart-card glass-panel" id="risk-timeline-container">
      <div className="chart-header-row">
        <div>
          <h3 className="panel-title">Risk Timeline</h3>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Continuous probability score over call duration
          </p>
        </div>

        <div className="chart-legend">
          <div className="legend-item">
            <span className="legend-line" style={{ background: lineColorRaw }}></span>
            <span>Risk</span>
          </div>
          <div className="legend-item">
            <span className="legend-line" style={{ background: '#E5484D', opacity: 0.5, borderTop: '1px dashed #E5484D' }}></span>
            <span>Threshold</span>
          </div>
        </div>
      </div>

      <div style={{ width: '100%', height: '220px', position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="risk-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColorRaw} stopOpacity="0.12" />
              <stop offset="100%" stopColor={lineColorRaw} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines */}
          {[0, 25, 50, 75, 100].map((level) => {
            const y = getY(level);
            return (
              <g key={level}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="var(--border-hairline)"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  {level}
                </text>
              </g>
            );
          })}

          {/* Alert Threshold Boundary line */}
          <line
            x1={padding.left}
            y1={thresholdY}
            x2={width - padding.right}
            y2={thresholdY}
            stroke="var(--accent-red)"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity="0.35"
          />

          {/* Area Fill Under Curve */}
          <path d={areaD} fill="url(#risk-gradient)" />

          {/* Risk Score Polyline — animated draw */}
          <path
            ref={pathRef}
            className="timeline-line-animated"
            d={pathD}
            fill="none"
            stroke={lineColorRaw}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points */}
          {points.map((pt, i) => {
            const ptCx = getX(pt.relative_sec);
            const ptCy = getY(pt.risk_score);
            const isLast = i === points.length - 1;
            const isPtAlert = pt.risk_score >= threshold;
            return (
              <circle
                key={i}
                cx={ptCx}
                cy={ptCy}
                r={isLast ? 4 : 2.5}
                fill={isPtAlert ? 'var(--accent-red)' : 'var(--accent-teal)'}
                stroke="var(--bg-surface)"
                strokeWidth="1.5"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            );
          })}

          {/* X Axis Time Labels */}
          <text
            x={padding.left}
            y={height - 8}
            fill="var(--text-muted)"
            fontSize="9"
            fontFamily="var(--font-mono)"
          >
            T+{minTime.toFixed(1)}s
          </text>
          <text
            x={width - padding.right}
            y={height - 8}
            textAnchor="end"
            fill="var(--text-muted)"
            fontSize="9"
            fontFamily="var(--font-mono)"
          >
            T+{maxTime.toFixed(1)}s
          </text>
        </svg>

        {/* Hover Tooltip */}
        {hoveredPoint && (
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '16px',
            background: 'var(--bg-surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '4px',
            padding: '5px 9px',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)'
          }}>
            T+{hoveredPoint.relative_sec}s · {hoveredPoint.risk_score}%
          </div>
        )}
      </div>
    </div>
  );
}
