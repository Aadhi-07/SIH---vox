import React, { useState } from 'react';

const SCENARIO_PRESETS = [
  {
    id: 'sih-digital-arrest',
    callId: 'call-digital-arrest',
    icon: '🚨',
    title: 'Digital Arrest Scam',
    tag: 'CBI / Police Clone',
    threat: 'Extortion under Sec 102 CrPC',
    riskLevel: 'CRITICAL (>95%)',
    transcript: 'Attention. This is Inspector Rajesh Sharma calling from Delhi Cyber Crime Cell. A formal FIR has been registered against your national identity for illegal money laundering. Under section 102 CrPC, you are placed under digital arrest immediately...',
    badgeColor: '#E5484D'
  },
  {
    id: 'sih-bank-kyc',
    callId: 'call-bank-kyc',
    icon: '🏦',
    title: 'Banking KYC & OTP Scam',
    tag: 'SBI Manager Clone',
    threat: 'Immediate NetBanking Wire Drain',
    riskLevel: 'CRITICAL (>95%)',
    transcript: 'Dear customer, this is Assistant Manager Vikram Malhotra from State Bank of India Centralized Security Operations. Your net banking access and debit card have been frozen due to unverified KYC. Read out the six-digit authorization token right now...',
    badgeColor: '#E8A855'
  },
  {
    id: 'sih-emergency-ransom',
    callId: 'call-emergency-ransom',
    icon: '👨‍👩‍👧',
    title: 'Emergency Kidnap Scam',
    tag: 'Student Voice Clone',
    threat: 'Coercive Distress UPI Ransom',
    riskLevel: 'CRITICAL (>95%)',
    transcript: 'Dad, please help me, I am in terrible trouble! The police stopped us and the inspector is demanding sixty thousand rupees bail right now. Send the funds to the inspector UPI ID right now or they will lock me up in the central jail. Hurry dad!',
    badgeColor: '#E5484D'
  },
  {
    id: 'sih-bonafide-citizen',
    callId: 'call-citizen-verified',
    icon: '🛡️',
    title: 'Verified Citizen Voice',
    tag: 'Natural Human Telephony',
    threat: 'Legitimate Citizen Interaction',
    riskLevel: 'SAFE (<15%)',
    transcript: 'Natural conversational citizen speech exhibiting organic glottal pulses, authentic cycle-to-cycle micro-jitter, and natural breathing pauses.',
    badgeColor: '#4FD1AE'
  }
];

export default function SIHScenarioBar({
  selectedCallId,
  onSelectScenario,
  onStartLiveMic,
  onOpenDossier,
  isSimulating = false
}) {
  const [expandedScenario, setExpandedScenario] = useState(null);

  const handlePresetClick = (preset) => {
    onSelectScenario(preset);
    setExpandedScenario(preset.id === expandedScenario ? null : preset.id);
  };

  return (
    <div className="glass-panel" style={{ margin: '12px 28px 0', padding: '10px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>🇮🇳</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: '12px',
                fontWeight: '600',
                letterSpacing: '0.3px',
                color: 'var(--text-primary)',
                textTransform: 'uppercase'
              }}>
                Scenarios
              </span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              1-Click scenarios for demonstration
            </div>
          </div>
        </div>

        {/* Scenario buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          {SCENARIO_PRESETS.map((preset) => {
            const isSelected = selectedCallId === preset.callId;
            return (
              <button
                key={preset.id}
                id={`sih-btn-${preset.id}`}
                onClick={() => handlePresetClick(preset)}
                disabled={isSimulating}
                style={{
                  background: isSelected ? 'var(--bg-surface-raised)' : 'transparent',
                  border: isSelected ? `1px solid ${preset.badgeColor}44` : '1px solid var(--border-hairline)',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
                  padding: '5px 10px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: '500',
                  cursor: isSimulating ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontFamily: 'var(--font-sans)'
                }}
                title={preset.threat}
              >
                <span>{preset.icon}</span>
                <span>{preset.title}</span>
              </button>
            );
          })}

          {/* Test Live Mic Button */}
          <button
            id="btn-sih-live-mic"
            onClick={onStartLiveMic}
            style={{
              background: 'transparent',
              border: '1px solid rgba(232, 168, 85, 0.2)',
              color: 'var(--accent-amber)',
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
            title="Test real-time detection on your live microphone"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <span>Live Mic</span>
          </button>

          {/* I4C Dossier Button */}
          <button
            id="btn-sih-open-dossier"
            onClick={() => onOpenDossier && onOpenDossier(selectedCallId)}
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
            title="Generate official Law Enforcement Forensic Incident Report"
          >
            📄 Dossier
          </button>
        </div>
      </div>
    </div>
  );
}
