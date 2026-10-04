# Formant Privacy & Data Retention Policy

This document defines the exact data storage, retention, and ephemeral processing boundaries implemented in the Formant prototype codebase.

---

## 1. What Is Stored

Formant stores only operational metadata and derived numerical telemetry in volatile application memory (`calls_db` and `stats_db`). No relational or persistent database is used.

### In-Memory Call Metadata
- **Call Identifiers**: `call_id`, `caller_name`, `department`.
- **Session Timestamps**: `start_time`, `last_updated`.
- **Call State**: `status` (`streaming`, `PENDING_REVIEW`, `BLOCKED`, `CLEARED`, or `ended`).
- **Review Counters**: In-memory counts of `{alerts_raised, confirmed_blocks, dismissed_false_positives}`.

### Derived Numerical Scores & Telemetry
- **Risk Score**: Float ($0.0 - 100.0$) representing synthetic clone probability.
- **Confidence Score**: Float ($0.0 - 100.0$) representing classifier certainty margin.
- **Alert Flags**: Boolean (`alert = true` when `risk_score >= 70.0`).
- **Forensic Acoustic Indicators**: Summary scalar statistics derived from audio:
  - Spectral Flatness & Centroid
  - Pitch F0 Mean & Standard Deviation
  - Local Jitter & Local Shimmer
- **Rolling Timeline History**: Ring buffer capped at $200$ timestamped risk score points for telemetry graphing.

### Static Model Artifacts
- Serialized model weights (`ml/artifacts/model.pkl`).
- Benchmark evaluation metrics and test split counts (`ml/artifacts/metrics.json`).

---

## 2. What Is Explicitly NOT Stored

### Raw Audio Files (No Disk Persistence)
- Uploaded audio files received via `POST /calls/upload` are temporarily written to disk solely to allow `soundfile`/`librosa` decoding, and are **immediately unlinked (`file_path.unlink()`) in a `finally` block** as soon as decoded into memory.
- The `data/uploads/` directory is ephemeral and holds zero audio files after ingestion.

### Live In-Memory Audio Buffers (Ephemeral Rolling Window)
- The live streaming WebSocket (`/ws/call/{call_id}`) maintains a strict rolling buffer bounded to `DEFAULT_WINDOW_SEC` ($2.0$ seconds at $16\,\text{kHz} = 32{,}000$ samples).
- Audio frames older than the active $2.0$-second analysis window are **immediately discarded**.
- Upon call disconnect or termination, the audio buffer is **explicitly deleted from memory (`del rolling_buffer`)**.

### Peer-to-Peer WebRTC Media
- The WebRTC signaling endpoint (`/ws/signal/{room_id}`) functions strictly as an out-of-band signaling relay for SDP offers, SDP answers, and ICE candidates.
- WebRTC media travels peer-to-peer (P2P) between endpoints; Formant's backend server never terminates, decrypts, or persists WebRTC RTP/SRTP media streams.

### Long-Term Session Persistence
- No relational database (PostgreSQL, MySQL, SQLite) or persistent key-value store is configured.
- When the API process is stopped, all in-memory call records and operational counters are completely reset.
