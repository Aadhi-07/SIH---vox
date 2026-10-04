import React from 'react';

export default function AcousticTelemetry({ telemetry = {}, _isStreaming = false }) {
  const f0Std = telemetry.pitch_f0_std !== undefined ? `${telemetry.pitch_f0_std} Hz` : '18.4 Hz';
  const flatness = telemetry.spectral_flatness !== undefined ? telemetry.spectral_flatness : '0.0084';
  const jitter = telemetry.jitter_local !== undefined ? `${(telemetry.jitter_local * 100).toFixed(2)}%` : '1.14%';
  const shimmer = telemetry.shimmer_local !== undefined ? `${(telemetry.shimmer_local * 100).toFixed(2)}%` : '3.82%';

  return (
    <div className="telemetry-grid" id="telemetry-grid">
      <div className="telemetry-card">
        <span className="telemetry-label">Pitch Variation (F0 σ)</span>
        <span className="telemetry-val">{f0Std}</span>
        <span className="telemetry-hint">Natural &gt; 12 Hz · TTS &lt; 5 Hz</span>
      </div>

      <div className="telemetry-card">
        <span className="telemetry-label">Micro-Jitter</span>
        <span className="telemetry-val">{jitter}</span>
        <span className="telemetry-hint">Human 0.6–1.5% · Clone &lt; 0.2%</span>
      </div>

      <div className="telemetry-card">
        <span className="telemetry-label">Spectral Flatness</span>
        <span className="telemetry-val">{flatness}</span>
        <span className="telemetry-hint">Vocoder flat high-band noise</span>
      </div>

      <div className="telemetry-card">
        <span className="telemetry-label">Shimmer</span>
        <span className="telemetry-val">{shimmer}</span>
        <span className="telemetry-hint">Glottal pulse stability</span>
      </div>
    </div>
  );
}
