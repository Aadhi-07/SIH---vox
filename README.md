# 🇮🇳 Formant: National AI Voice-Clone & Telecom Deepfake Defense System
### Smart India Hackathon (SIH) Prototype • Ministry of Home Affairs / I4C Alignment

**Formant** is an AI-powered defensive telecommunications cybersecurity system engineered to detect synthetic voice clones and telephone deepfake fraud in real-time. It processes streaming audio chunks over WebSockets, calculates a continuous **Voice Clone Risk Score (0–100)** over sliding windows, and immediately triggers visual fraud alerts, human-in-the-loop review, and official **Indian Cybercrime Coordination Centre (I4C / 1930 Helpline)** forensic evidentiary dossiers.

---

## 🚀 1-Click Hackathon Launcher

To start the entire prototype (FastAPI backend, Vite dashboard, and browser) in a single click:

```cmd
:: On Windows (Double-click or run from terminal):
run_sih_prototype.bat
```
*(PowerShell alternative: `powershell -ExecutionPolicy Bypass -File .\run_sih_prototype.ps1`)*

- **Verifier Operations Console**: [http://localhost:5173](http://localhost:5173)
- **Official I4C Forensic Report Demo**: [http://localhost:8000/calls/call-digital-arrest/dossier/html](http://localhost:8000/calls/call-digital-arrest/dossier/html)
- **WebRTC Peer-to-Peer Encrypted Calling**: [http://localhost:5173/?view=call&room=demo-call](http://localhost:5173/?view=call&room=demo-call)
- **Complete Jury Pitch & Defense Guide**: See [SIH_PITCH_AND_DEMO_GUIDE.md](file:///z:/attendX/vox/SIH_PITCH_AND_DEMO_GUIDE.md)

### Testing on another device (phone, LAN):
Start the backend with `python -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000` (not the default, which only binds to localhost), then open the dashboard using your machine's LAN IP instead of localhost — the app will auto-detect the correct backend host.

---

## Architecture Overview

```
                      +-------------------------------------------------------+
                      |                 Audio Input Stream                    |
                      |   (Real-Time Phone Audio / demo/stream_call.py Client)|
                      +---------------------------+---------------------------+
                                                  |
                                                  | Binary PCM / WAV Chunks
                                                  v
+-------------------------------------------------------------------------------------------------+
| Formant API Backend (FastAPI / Uvicorn on Port 8000)                                            |
|                                                                                                 |
|   +-----------------------+       +------------------------------------+                        |
|   | /ws/call/{call_id}    | ----> | Rolling Audio Buffer               |                        |
|   | WebSocket Ingestion   |       | (Window: 2.0s, Hop: 0.5s)          |                        |
|   +-----------------------+       +-----------------+------------------+                        |
|                                                     |                                           |
|                                                     v                                           |
|   +-------------------------------------------------------------------------------------------+ |
|   | ML Forensic Engine (ml/inference.py)                                                      | |
|   |   1. MFCCs + Deltas + Delta-Deltas (Librosa)                                              | |
|   |   2. Spectral Flatness & Octave Contrast (Librosa)                                        | |
|   |   3. Pitch (F0) & Micro-Perturbations: Jitter & Shimmer (Praat/Parselmouth)               | |
|   |   4. Calibrated Probability Classifier (ml/artifacts/model.pkl)                           | |
|   +-------------------------------------------------+-----------------------------------------+ |
|                                                     |                                           |
|                                                     v                                           |
|   +-------------------------------------------------------------------------------------------+ |
|   | Call State Manager & Law Enforcement Dispatcher                                           | |
|   |   - Broadcast JSON: {"call_id", "timestamp", "risk_score", "alert", "telemetry"}          | |
|   |   - REST Endpoints: GET /calls, GET /sih/scenarios, GET /calls/{call_id}/dossier          | |
|   |   - Statutory Referral: Section 66D IT Act 2000 & CFCFRMS 1930 Portal Integration        | |
|   +-------------------------------------------------+-----------------------------------------+ |
+-----------------------------------------------------|-------------------------------------------+
                                                      |
                                                      | WebSocket Broadcast (/ws/dashboard)
                                                      v
+-------------------------------------------------------------------------------------------------+
| Formant Verifier Dashboard (React + Vite on Port 5173)                                          |
|                                                                                                 |
|   - Real-Time Radial Risk Gauge (0-100%) with Calibrated Confidence Metric                      |
|   - Scrolling Risk Timeline Chart with 70% Alert Boundary Threshold                             |
|   - 1-Click SIH Threat Scenarios Bar (Digital Arrest, SBI KYC Fraud, Student Ransom Distress)   |
|   - In-Console Live Microphone Voice Verification Modal                                         |
|   - Official I4C Forensic Evidence Incident Dossier (Downloadable JSON & Printable Legal PDF)   |
|   - Human-in-the-Loop Review Controls (Confirm Block vs. Dismiss False Positive)                |
+-------------------------------------------------------------------------------------------------+
```

---

## 🇮🇳 Smart India Hackathon Demonstration Scenarios

Clicking any preset button in the dashboard immediately streams real-time audio and evaluates the live risk trajectory:

1. **🚨 Digital Arrest Extortion Scam (`sih_digital_arrest.wav`)**:
   - Cloned Delhi Police / CBI officer claiming money laundering under Sec 102 CrPC.
   - **Risk Score: 98.6%** -> Triggers flashing High-Urgency Fraud Alert Banner.
2. **🏦 Banking KYC Expiry & OTP Extortion (`sih_banking_kyc.wav`)**:
   - Cloned State Bank of India security manager demanding verbal OTP authorization.
   - **Risk Score: 97.8%** -> Triggers Human-in-the-Loop Verification Review.
3. **👨‍👩‍👧 Emergency Relative Distress Clone (`sih_emergency_ransom.wav`)**:
   - Cloned college student voice frantically demanding emergency UPI bail payment.
   - **Risk Score: 98.2%** -> Triggers automatic Law Enforcement Dossier Generation.
4. **🛡️ Verified Citizen Telephony (`sih_bonafide_citizen.wav`)**:
   - Authentic human conversational prosody, natural vocal tract formants, and organic micro-jitter.
   - **Risk Score: 13.9% (Green Safe)** -> Zero false positives!
5. **🎙️ Direct Live Microphone Test**:
   - Speak live into the device microphone. Formant processes chunks in real-time, verifying authentic human voice dynamics.

---

## Quickstart Instructions

### 1. Start FastAPI Backend
```bash
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Start Dashboard
```bash
cd dashboard
npm run dev
# Accessible at http://127.0.0.1:5173
```

### 3. Run Automated SIH Test Suite
```bash
python test_sih_pipeline.py
```

### 4. Upload Custom Audio Files (.wav, .mp3)
In the dashboard at [http://localhost:5173](http://localhost:5173), click the **"Upload Audio File (.wav, .mp3)"** button on the left panel.
Select any `.wav` or `.mp3` file to immediately stream and analyze its risk score and acoustic telemetry live!

---

## Real-Time WebRTC Two-Way Audio Calls

Formant supports live peer-to-peer WebRTC audio calling with real-time remote-speaker voice clone detection.

### Testing Locally on Desktop (Two Browser Tabs)
1. Open Tab 1: **[http://localhost:5173/?view=call&room=demo-call](http://localhost:5173/?view=call&room=demo-call)**
2. Click **"Connect & Join Call"** and grant microphone permissions.
3. Open Tab 2: **[http://localhost:5173/?view=call&room=demo-call](http://localhost:5173/?view=call&room=demo-call)** (or in an Incognito window).
4. Click **"Connect & Join Call"**.
5. Both tabs establish an encrypted peer-to-peer WebRTC call with two-way audio.
6. The incoming remote speaker's audio track is tapped and analyzed in real-time sliding windows.
7. Speak with a natural human voice -> Risk Gauge remains low (green, ~3–10%).
8. Play a synthetic/cloned audio sample (or `demo_spoofed.wav`) into the microphone -> Risk score surges to >85%, triggering the **Red Impersonation Fraud Alert Banner**!

### Testing from Mobile Devices (HTTPS Tunnel Setup)
Mobile browsers (iOS Safari, Android Chrome) enforce a strict security policy requiring HTTPS for microphone access (`getUserMedia`).

#### Option A: Built-in HTTPS with Vite Basic SSL
Start Vite with the HTTPS script:
```bash
cd dashboard
npm run dev:https
```
Access via your local Wi-Fi IP (e.g. `https://192.168.1.X:5173`). Accept the self-signed certificate in your mobile browser.

#### Option B: Using ngrok or Cloudflare Tunnels (Recommended for Cellular/Remote Devices)
Run an HTTPS tunnel to expose the dashboard and API:
```bash
# Terminal 1: Expose dashboard
ngrok http 5173

# Terminal 2: Expose API (if testing across different networks)
ngrok http 8000
```
Open the generated HTTPS URL on both phones to place live encrypted WebRTC calls anywhere.
