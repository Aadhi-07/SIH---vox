# Formant: Real-Time AI Voice-Clone Detection System
## Architectural Design & Implementation Plan

### 1. Executive Summary & Architecture Overview
**Formant** is a defensive cybersecurity prototype engineered to detect AI voice cloning and synthetic deepfakes in real-time phone calls. It calculates a streaming **Voice Spoof Risk Score (0–100)** over sliding audio windows. If an impersonator initiates a voice-clone attack (e.g., executive spoofing, social engineering, wire fraud), the risk score surges past a defined threshold (70/100), triggering immediate visual alerts and warnings for call verification agents.

```
                      +-------------------------------------------------------------+
                      |                      Audio Input Source                     |
                      |  (Real-Time Phone Call Stream / demo/stream_call.py Client) |
                      +------------------------------+------------------------------+
                                                     |
                                                     | Binary PCM / WAV Chunks (WebSocket)
                                                     v
+---------------------------------------------------------------------------------------------------+
| Formant API Backend (FastAPI / Uvicorn)                                                          |
|                                                                                                   |
|  +---------------------------+       +---------------------------------+                          |
|  | /ws/call/{call_id}        | ----> | Rolling Audio Buffer            |                          |
|  | WebSocket Ingestion       |       | (Window: 2.0s, Hop: 0.5s)       |                          |
|  +---------------------------+       +----------------+----------------+                          |
|                                                       |                                           |
|                                                       v                                           |
|  +---------------------------------------------------------------------------------------------+  |
|  | ML Inference Engine (ml/inference.py)                                                       |  |
|  |   1. Feature Extraction (MFCCs, Spectral Flatness/Contrast, Pitch/F0, Jitter/Shimmer)        |  |
|  |   2. Preprocessing & Scaler Transform                                                       |  |
|  |   3. Trained Ensemble / MLP Classifier (ml/artifacts/model.pkl)                             |  |
|  |   4. Calibrated Probability -> Risk Score (0-100)                                           |  |
|  +--------------------------------------------+------------------------------------------------+  |
|                                               |                                                   |
|                                               v                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | State Manager & Event Dispatcher (In-memory Call Registry)                                  |  |
|  |   - Broadcast JSON: {"call_id", "timestamp", "risk_score", "alert", "stats"}                |  |
|  |   - REST API: GET /calls, GET /calls/{call_id}/history                                      |  |
|  +--------------------------------------------+------------------------------------------------+  |
+-----------------------------------------------|---------------------------------------------------+
                                                |
                                                | WebSocket Events & REST Polls
                                                v
+---------------------------------------------------------------------------------------------------+
| Formant Verifier Dashboard (React + Vite, Vanilla CSS Modern Glassmorphism)                     |
|                                                                                                   |
|  +-----------------------------+  +------------------------------------------------------------+  |
|  | Active Calls Sidebar        |  | Selected Call Inspection Deck                              |  |
|  | - Call ID & Agent Metadata  |  | - Live Risk Score Gauge (0-100) with dynamic color scale    |  |
|  | - Real-time Risk Level Pill |  | - Scrolling Risk Score Line Chart (Time vs. Score)         |  |
|  | - Alert Status Indicator    |  | - Red Flashing Impersonation Alert Banner (Score >= 70)    |  |
|  +-----------------------------+  | - Audio Waveform / Spectrogram Activity Pulse              |  |
|                                   | - Acoustic Feature Breakdown (Pitch jitter, Spectral flux) |  |
|                                   +------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

### 2. Core Components Specification

#### Component 1: Data Pipeline (`ml/data/`)
* **ASVspoof 2019 Logical Access (LA) Ingestion (`ml/data/fetch_asvspoof.py`)**:
  - Implements downloading logic and protocol parsing for the ASVspoof 2019 dataset (`bonafide` vs `spoof` labels from protocol `.txt` files).
  - Directory structure layout: `data/bonafide/` and `data/spoofed/`.
  - Manual download instructions and mirrors (Zenodo / Edinburgh DataShare) clearly documented.
* **Synthetic & Demo Dataset Fallback (`ml/data/generate_demo_dataset.py`)**:
  - Generates labeled bonafide and spoofed samples to guarantee offline reproducibility without gigabytes of external downloads.
  - **Bonafide**: Uses clean human speech recordings (synthesizing acoustic naturalness via multi-speaker phonetic phonemes, micro-pitch jitter, formant variation, natural room reverberation) and public domain clean speech.
  - **Spoofed**: Uses multiple TTS engines (Windows SAPI / pyttsx3 / edge-tts / neural TTS synthesis) exhibiting tell-tale synthetic artifacts (spectral discontinuity, unnaturally flat jitter, robotic pitch contours, phase artifacts).
  - Generates dedicated test calls: `data/demo_bonafide.wav` (natural speaker) and `data/demo_spoofed.wav` (synthetic clone impersonation).

#### Component 2: Feature Extraction Pipeline (`ml/feature_extraction.py`)
* Inputs: WAV file path or raw float/int audio array + sampling rate (default 16 kHz).
* Fixed-length acoustic fingerprint containing complementary forensic indicators:
  1. **MFCCs (Mel-Frequency Cepstral Coefficients)**:
     - 13 to 20 MFCCs (captures vocal tract shape and phonetic spectra).
     - First-order ($\Delta$) and second-order ($\Delta\Delta$) derivatives to capture temporal transitions.
     - Mean and variance per coefficient.
  2. **Spectral Flatness & Spectral Contrast (Librosa)**:
     - Measures whether sound is tone-like or noise-like across frequency bands.
     - Synthetic vocoders leave distinct spectral artifacts and over-smoothed harmonic structures.
  3. **Pitch (F0) & Voice Micro-perturbations (Parselmouth / Praat)**:
     - Fundamental frequency statistics (mean, standard deviation, min, max).
     - **Jitter** (local, rap, ppq5): Micro-instability in cycle-to-cycle pitch periods (humans naturally have jitter 0.5–1.5%; TTS models are unnaturally smooth or erratic).
     - **Shimmer** (local, apq3, apq5): Micro-instability in cycle-to-cycle amplitude.
     - Robust fallback implemented if Praat C-extensions are unavailable on the target platform.
  4. **Spectral Rolloff & Zero-Crossing Rate**:
     - Captures high-frequency cutoff often introduced by vocoders or downsampling.
* **Window Chunking Engine**:
  - Function `chunk_audio_stream(audio_array, sr, window_size_sec=2.0, hop_size_sec=0.5)` to provide continuous rolling analysis for streaming audio.

#### Component 3: Machine Learning Model & Training (`ml/model.py`, `ml/train.py`, `ml/inference.py`)
* **Classifier Model**:
  - Supervised binary classifier: Calibrated Ensemble (Gradient Boosting / Random Forest / Scikit-learn MLP).
  - Handles class imbalance and provides calibrated probability estimates $P(\text{spoof} \mid X)$.
* **Training Pipeline (`ml/train.py`)**:
  - Scans `data/bonafide` and `data/spoofed`.
  - Extracts feature vectors across chunks.
  - Standardizes features using `StandardScaler` (saved alongside model).
  - Evaluates on 80/20 train/test split: computes Accuracy, Precision, Recall, F1, and ROC-AUC.
  - Serializes trained pipeline to `ml/artifacts/model.pkl`.
* **Real-Time Inference (`ml/inference.py`)**:
  - Thread-safe `VoiceCloneDetector` class.
  - Exposes `score_audio_chunk(audio_array, sample_rate) -> dict`:
    - Returns `risk_score` (0 to 100 integer/float).
    - Returns `confidence`, `is_spoofed` (bool), and feature metrics for explainability.

#### Component 4: High-Performance Backend API (`api/main.py`)
* Framework: FastAPI with Uvicorn.
* In-memory Session & Call State Management:
  - Tracks active and completed calls, start time, latest risk score, score history, and alert state.
* **Streaming WebSocket (`/ws/call/{call_id}`)**:
  - Ingests binary audio chunks (PCM 16-bit / float32 WAV bytes).
  - Accumulates into an internal circular rolling buffer (2.0s analysis window, step 0.5s).
  - Computes risk score per hop and broadcasts structured JSON:
    ```json
    {
      "call_id": "call-exec-101",
      "timestamp": 1727339400.12,
      "risk_score": 88.5,
      "alert": true,
      "threshold": 70,
      "features": {
        "pitch_std": 4.2,
        "spectral_flatness": 0.012,
        "jitter": 0.002
      }
    }
    ```
* **REST Endpoints**:
  - `GET /calls`: Returns all active/recent calls with latest score and status.
  - `GET /calls/{call_id}`: Returns call metadata and history.
  - `GET /health`: Health check.
  - `POST /calls/{call_id}/reset`: Reset call state.
* CORS configured for `http://localhost:5173`.

#### Component 5: Verifier Dashboard (`dashboard/`, React + Vite)
* Framework: React + Vite (JavaScript, clean modern styling).
* Theme: Dark cyber-security / SOC operations command center (deep slate `#0b0f19`, neon emerald `#10b981` for genuine, amber `#f59e0b` for suspicious, bright crimson `#ef4444` for spoofed fraud alert).
* Key UI Elements:
  1. **Active Calls Panel**: List of calls with live status badges (Low Risk, Elevating, FRAUD ALERT).
  2. **Risk Gauge / HUD**: Large circular/semi-circular risk meter (0–100) dynamically reacting to real-time packets.
  3. **Real-Time Timeline Chart**: SVG/Canvas live line chart showing score progression over the call duration.
  4. **High-Severity Alert Banner**: Flashing alert banner with warning icon, audio clip snippet metadata, and "FRAUD DETECTED: SYNTHETIC VOICE CLONE IDENTIFIED" message.
  5. **Audio Telemetry Panel**: Acoustic statistics breakdown (pitch variation, spectral smoothness, packet rate).
  6. **Manual Stream Simulator Control**: In-dashboard button allowing direct one-click testing of genuine vs. clone audio streams without external CLI switches if desired.

#### Component 6: End-to-End Simulation Script (`ml/demo/stream_call.py`)
* CLI client simulating a live telephone interface streaming audio over WebSocket.
* Arguments: `--wav <file_path>`, `--call_id <id>`, `--chunk_duration 0.5`, `--ws_url ws://localhost:8000/ws/call/{call_id}`.
* Streams realistic audio chunks at real-time rate (sleeping for chunk duration between packet dispatches).
* Displays live terminal dashboard with color-coded risk meter and alert trigger notifications.

---

### 3. Verification & Validation Steps
1. **Model Training Verification**:
   - Run `train.py`, verify feature extraction finishes cleanly, and output performance metrics (accuracy, precision, recall).
2. **Server & Dashboard Initialization**:
   - Launch FastAPI backend on port 8000.
   - Launch Vite React frontend on port 5173.
3. **End-to-End Live Stream Test**:
   - Stream `data/demo_bonafide.wav` as `call-human-01`: Verify score stays consistently low (< 35%) and no alert is triggered.
   - Stream `data/demo_spoofed.wav` as `call-clone-02`: Verify score rises rapidly (> 75%) and triggers the red FRAUD ALERT banner on the dashboard in real-time.
4. **Browser Testing & Video/Screenshot Evidence**:
   - Use browser subagent to interact with the dashboard, observe WebSocket updates, and capture screenshots of both genuine and cloned call states.
