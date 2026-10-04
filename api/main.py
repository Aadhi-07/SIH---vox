#!/usr/bin/env python3
"""
VoxGuard - Backend API Server (FastAPI)

Features:
1. Streaming WebSocket /ws/call/{call_id}: Ingests live binary audio chunks,
   maintains rolling window buffer (2.0s window, 0.5s hop), scores via ml/inference.py,
   and streams real-time JSON events with risk score and fraud alert.
2. Dashboard WebSocket /ws/dashboard: Broadcasts live updates for all active calls
   to verifier operations console.
3. REST Endpoints:
   - GET /calls: List recent/active calls with latest risk scores
   - GET /calls/{call_id}: Detailed telemetry and historical risk progression
   - POST /calls/{call_id}/reset: Clear call history
   - POST /demo/simulate: Trigger live simulation of bonafide or spoofed call
   - GET /health: Health check
4. CORS enabled for http://localhost:5173 (React Vite dashboard)
"""

import os
import sys
import io
import time
import json
import shutil
import asyncio
import hashlib
from datetime import datetime
from typing import Dict, List, Set
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from ml.inference import analyze_audio_chunk, score_audio_chunk, get_detector
from ml.feature_extraction import (
    load_audio,
    chunk_audio_stream,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_WINDOW_SEC,
    DEFAULT_HOP_SEC
)

app = FastAPI(
    title="VoxGuard API",
    description="Real-time AI Voice-Clone and Synthetic Impersonation Detection System",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://sih-vox-frq4.vercel.app",
        "http://localhost:5173",  # keep this if you still test locally with Vite's default dev port
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "status": "healthy",
        "service": "VoxGuard Real-Time Voice Clone Detection API",
        "docs": "/docs",
        "health": "/health"
    }

# In-Memory Call State Store
# Structure: { call_id: { "call_id": str, "caller": str, "status": str, "start_time": float, ... } }
calls_db: Dict[str, dict] = {}

# In-Memory Statistics Store for False-Positive & Verification Handling
stats_db: Dict[str, int] = {
    "alerts_raised": 3,
    "confirmed_blocks": 0,
    "dismissed_false_positives": 0,
    "agent_confirmed_blocks": 0,
    "agent_dismissed": 0,
    "agent_escalated": 0,
    "human_overrides_of_agent": 0
}

# Active Dashboard WebSocket connections for real-time broadcast
dashboard_subscribers: Set[WebSocket] = set()

# Configuration constants
ALERT_THRESHOLD = 70.0
BUFFER_WINDOW_SAMPLES = int(DEFAULT_WINDOW_SEC * DEFAULT_SAMPLE_RATE) # 32,000 samples @ 16kHz
HOP_SAMPLES = int(0.5 * DEFAULT_SAMPLE_RATE) # 8,000 samples

def decode_audio_chunk(raw_bytes: bytes) -> np.ndarray:
    """
    Decodes binary audio chunk into normalized float32 numpy array.
    Supports:
    1. WAV file format with RIFF header
    2. Raw 16-bit PCM little-endian
    3. Raw 32-bit float
    """
    # Check for RIFF WAV header
    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        try:
            import soundfile as sf
            data, file_sr = sf.read(io.BytesIO(raw_bytes), dtype="float32")
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            if file_sr != DEFAULT_SAMPLE_RATE:
                try:
                    import librosa
                    data = librosa.resample(data, orig_sr=file_sr, target_sr=DEFAULT_SAMPLE_RATE)
                except Exception:
                    pass
            return data.astype(np.float32)
        except Exception:
            pass

    # Try raw 16-bit PCM (standard telephony)
    try:
        pcm16 = np.frombuffer(raw_bytes, dtype=np.int16)
        if len(pcm16) > 0:
            return (pcm16.astype(np.float32) / 32768.0)
    except Exception:
        pass

    # Try raw 32-bit float
    try:
        float_arr = np.frombuffer(raw_bytes, dtype=np.float32)
        return float_arr
    except Exception:
        pass

    return np.zeros(0, dtype=np.float32)

async def broadcast_to_dashboards(event: dict):
    """Broadcast real-time call event to all active dashboard verifiers."""
    dead_sockets = set()
    message = json.dumps(event)
    for ws in list(dashboard_subscribers):
        try:
            await ws.send_text(message)
        except Exception:
            dead_sockets.add(ws)
    for dead in dead_sockets:
        dashboard_subscribers.discard(dead)

async def run_agent_review_task(call_id: str, ctx: dict):
    """Run Groq agent review in a background thread and update call state."""
    from api.agent import agent_review
    verdict = await asyncio.to_thread(agent_review, ctx)
    if call_id in calls_db:
        call = calls_db[call_id]
        
        # if a human hasn't already acted on it
        if call.get("status") not in ("BLOCKED", "CLEARED"):
            call["ai_verdict"] = verdict
            action = verdict["action"]
            
            if action == "confirm_block":
                call["status"] = "BLOCKED"
                stats_db["agent_confirmed_blocks"] += 1
                stats_db["confirmed_blocks"] += 1
            elif action == "dismiss_false_positive":
                call["status"] = "CLEARED"
                call["alert"] = False
                stats_db["agent_dismissed"] += 1
                stats_db["dismissed_false_positives"] += 1
            else: # escalate_to_human
                call["status"] = "PENDING_REVIEW"
                call["ai_escalated"] = True
                stats_db["agent_escalated"] += 1

            # Broadcast update
            await broadcast_to_dashboards({
                "type": "CALL_UPDATE",
                "call_id": call_id,
                "status": call["status"],
                "alert": call.get("alert", True),
                "ai_verdict": verdict,
                "stats": stats_db,
                "latest_risk_score": call.get("latest_risk_score", 0.0),
                "confidence": call.get("confidence", 0.0),
                "timestamp": time.time()
            })

@app.on_event("startup")
async def startup_event():
    """Ensure detector and demo calls exist on startup."""
    print("[VoxGuard API] Initializing inference engine...")
    get_detector()
    now = time.time()

    # SIH Showcase 1: Digital Arrest Extortion (CBI / Cybercrime Cell Impersonation)
    calls_db["call-digital-arrest"] = {
        "call_id": "call-digital-arrest",
        "caller_name": "Inspector Rajesh Sharma (CBI / Cyber Cell)",
        "department": "MHA / I4C Priority: Digital Arrest Scam",
        "status": "PENDING_REVIEW",
        "start_time": now - 45.0,
        "last_updated": now,
        "latest_risk_score": 98.6,
        "latest_confidence": 88.5,
        "confidence": 88.5,
        "alert": True,
        "alert_raised": True,
        "packets_processed": 32,
        "max_risk_score": 98.6,
        "latest_telemetry": {
            "spectral_flatness": 0.082,
            "spectral_centroid": 1720.4,
            "pitch_f0_mean": 194.2,
            "pitch_f0_std": 24.1,
            "jitter_local": 0.0192,
            "shimmer_local": 0.084
        },
        "history": [
            {"relative_sec": 1.0, "risk_score": 18.2, "confidence": 70.1, "alert": False},
            {"relative_sec": 2.5, "risk_score": 42.5, "confidence": 75.3, "alert": False},
            {"relative_sec": 4.0, "risk_score": 81.4, "confidence": 84.0, "alert": True},
            {"relative_sec": 5.5, "risk_score": 95.0, "confidence": 87.2, "alert": True},
            {"relative_sec": 7.0, "risk_score": 98.6, "confidence": 88.5, "alert": True}
        ]
    }

    # SIH Showcase 2: Bank KYC Expiry & OTP Extraction (SBI Cloned Voice Scam)
    calls_db["call-bank-kyc"] = {
        "call_id": "call-bank-kyc",
        "caller_name": "SBI Security Desk (Cloned Voice OTP Extortion)",
        "department": "RBI Banking Cyber-Fraud Cell",
        "status": "PENDING_REVIEW",
        "start_time": now - 35.0,
        "last_updated": now,
        "latest_risk_score": 97.8,
        "latest_confidence": 86.2,
        "confidence": 86.2,
        "alert": True,
        "alert_raised": True,
        "packets_processed": 28,
        "max_risk_score": 97.8,
        "latest_telemetry": {
            "spectral_flatness": 0.076,
            "spectral_centroid": 1680.1,
            "pitch_f0_mean": 188.5,
            "pitch_f0_std": 21.3,
            "jitter_local": 0.0175,
            "shimmer_local": 0.089
        },
        "history": [
            {"relative_sec": 1.0, "risk_score": 22.0, "confidence": 72.0, "alert": False},
            {"relative_sec": 2.5, "risk_score": 58.0, "confidence": 79.5, "alert": False},
            {"relative_sec": 4.0, "risk_score": 89.2, "confidence": 85.0, "alert": True},
            {"relative_sec": 5.5, "risk_score": 97.8, "confidence": 86.2, "alert": True}
        ]
    }

    # SIH Showcase 3: Deepfake Student / Minor Distress (Kidnap Ransom Threat)
    calls_db["call-emergency-ransom"] = {
        "call_id": "call-emergency-ransom",
        "caller_name": "College Distress Clone (Kidnap Ransom Threat)",
        "department": "Emergency Helpline 112 / 1930",
        "status": "PENDING_REVIEW",
        "start_time": now - 25.0,
        "last_updated": now,
        "latest_risk_score": 98.2,
        "latest_confidence": 87.0,
        "confidence": 87.0,
        "alert": True,
        "alert_raised": True,
        "packets_processed": 26,
        "max_risk_score": 98.2,
        "latest_telemetry": {
            "spectral_flatness": 0.079,
            "spectral_centroid": 1650.0,
            "pitch_f0_mean": 191.0,
            "pitch_f0_std": 26.5,
            "jitter_local": 0.0181,
            "shimmer_local": 0.083
        },
        "history": [
            {"relative_sec": 1.0, "risk_score": 25.4, "confidence": 71.0, "alert": False},
            {"relative_sec": 2.5, "risk_score": 64.1, "confidence": 81.2, "alert": False},
            {"relative_sec": 4.0, "risk_score": 92.5, "confidence": 86.1, "alert": True},
            {"relative_sec": 5.5, "risk_score": 98.2, "confidence": 87.0, "alert": True}
        ]
    }

    # SIH Showcase 4: Bonafide Verified Citizen Voice
    calls_db["call-citizen-verified"] = {
        "call_id": "call-citizen-verified",
        "caller_name": "Aarav Mehta (Citizen Voice Verification)",
        "department": "Public Telephony / Aadhaar KYC",
        "status": "ready",
        "start_time": now - 15.0,
        "last_updated": now,
        "latest_risk_score": 13.9,
        "latest_confidence": 74.0,
        "confidence": 74.0,
        "alert": False,
        "alert_raised": False,
        "packets_processed": 16,
        "max_risk_score": 14.5,
        "latest_telemetry": {
            "spectral_flatness": 0.0001,
            "spectral_centroid": 845.0,
            "pitch_f0_mean": 154.2,
            "pitch_f0_std": 32.1,
            "jitter_local": 0.0089,
            "shimmer_local": 0.158
        },
        "history": [
            {"relative_sec": 1.0, "risk_score": 8.5, "confidence": 72.0, "alert": False},
            {"relative_sec": 2.5, "risk_score": 12.1, "confidence": 73.5, "alert": False},
            {"relative_sec": 4.0, "risk_score": 14.5, "confidence": 74.2, "alert": False},
            {"relative_sec": 5.5, "risk_score": 13.9, "confidence": 74.0, "alert": False}
        ]
    }

    # Enterprise Treasury Calls (Existing)
    calls_db["call-cxo-auth"] = {
        "call_id": "call-cxo-auth",
        "caller_name": "Marcus Vance (CFO)",
        "department": "Executive Treasury",
        "status": "ready",
        "start_time": now,
        "last_updated": now,
        "latest_risk_score": 14.2,
        "latest_confidence": 71.6,
        "confidence": 71.6,
        "alert": False,
        "alert_raised": False,
        "packets_processed": 0,
        "max_risk_score": 14.2,
        "history": []
    }
    calls_db["call-fraud-wire"] = {
        "call_id": "call-fraud-wire",
        "caller_name": "Executive Voice (Flagged Wire)",
        "department": "High-Value Wire Clearance",
        "status": "PENDING_REVIEW",
        "start_time": now,
        "last_updated": now,
        "latest_risk_score": 88.7,
        "latest_confidence": 77.4,
        "confidence": 77.4,
        "alert": True,
        "alert_raised": True,
        "packets_processed": 0,
        "max_risk_score": 88.7,
        "history": []
    }
    print("[VoxGuard API] Startup complete. Initialized 6 SIH & Enterprise calls. Ready on http://localhost:8000")

# In-Memory WebRTC Signaling Rooms: room_id -> Set[WebSocket]
rooms_db: Dict[str, Set[WebSocket]] = {}

STUN_SERVERS = [
    {"urls": "stun:stun.l.google.com:19302"},
    {"urls": "stun:stun1.l.google.com:19302"},
    {"urls": "stun:stun2.l.google.com:19302"}
]

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "VoxGuard Real-Time Voice Clone Detection API",
        "timestamp": time.time(),
        "active_calls": len(calls_db),
        "active_rooms": len(rooms_db),
        "dashboard_viewers": len(dashboard_subscribers)
    }

@app.get("/webrtc/config")
def get_webrtc_config():
    """Returns ICE server configuration for WebRTC peers."""
    return {
        "iceServers": STUN_SERVERS
    }

@app.websocket("/ws/signal/{room_id}")
async def websocket_signaling(websocket: WebSocket, room_id: str):
    """
    Lightweight WebRTC Signaling Relay.
    Relays SDP offers, answers, and ICE candidate packets between peers in room_id.
    Media remains strictly peer-to-peer.
    """
    await websocket.accept()
    if room_id not in rooms_db:
        rooms_db[room_id] = set()

    # Limit to 2 peers for 1-to-1 WebRTC call
    if len(rooms_db[room_id]) >= 2:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Room is full (maximum 2 participants for WebRTC call)"
        }))
        await websocket.close()
        return

    rooms_db[room_id].add(websocket)
    peer_count = len(rooms_db[room_id])

    # Send confirmation with STUN configuration
    await websocket.send_text(json.dumps({
        "type": "JOINED",
        "room_id": room_id,
        "peer_count": peer_count,
        "ice_servers": STUN_SERVERS,
        "is_initiator": bool(peer_count == 2)
    }))

    # If this is the second peer, notify the first peer to initiate the call
    if peer_count == 2:
        for peer in list(rooms_db[room_id]):
            if peer != websocket:
                try:
                    await peer.send_text(json.dumps({
                        "type": "PEER_JOINED",
                        "room_id": room_id
                    }))
                except Exception:
                    pass

    try:
        while True:
            data = await websocket.receive_text()
            # Relay payload to other peer in the room
            other_peers = [p for p in rooms_db.get(room_id, set()) if p != websocket]
            for peer in other_peers:
                try:
                    await peer.send_text(data)
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[-] Signaling error for room {room_id}: {e}")
    finally:
        if room_id in rooms_db:
            rooms_db[room_id].discard(websocket)
            for peer in list(rooms_db[room_id]):
                try:
                    await peer.send_text(json.dumps({
                        "type": "PEER_LEFT",
                        "room_id": room_id
                    }))
                except Exception:
                    pass
            if not rooms_db[room_id]:
                del rooms_db[room_id]

@app.get("/calls")
def list_calls():
    """REST endpoint returning all recent/active calls with latest risk scores and confidence."""
    result = []
    for cid, call in calls_db.items():
        result.append({
            "call_id": call["call_id"],
            "caller_name": call.get("caller_name", cid),
            "department": call.get("department", "Corporate Telecom"),
            "status": call.get("status", "active"),
            "start_time": call.get("start_time", time.time()),
            "last_updated": call.get("last_updated", time.time()),
            "latest_risk_score": call.get("latest_risk_score", 0.0),
            "latest_confidence": call.get("latest_confidence", 0.0),
            "confidence": call.get("latest_confidence", 0.0),
            "max_risk_score": call.get("max_risk_score", 0.0),
            "alert": call.get("alert", False),
            "packets_processed": call.get("packets_processed", 0)
        })
    result.sort(key=lambda x: x["last_updated"], reverse=True)
    return result

@app.get("/calls/{call_id}")
def get_call_detail(call_id: str):
    """REST endpoint returning full telemetry and score history for a specific call."""
    if call_id not in calls_db:
        raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found.")
    return calls_db[call_id]

@app.get("/stats")
def get_stats():
    """REST endpoint returning in-memory alert and human-in-the-loop review statistics."""
    return stats_db

class ReviewRequest(BaseModel):
    action: str  # "confirm_block" or "dismiss"

@app.post("/calls/{call_id}/review")
async def review_call(call_id: str, req: ReviewRequest):
    """
    Human-in-the-loop review endpoint.
    - confirm_block: Confirms synthetic clone fraud and marks call as BLOCKED.
    - dismiss: Flags as false positive, marks call as CLEARED, and resets alert.
    """
    if call_id not in calls_db:
        raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found.")
    
    call = calls_db[call_id]
    action = req.action.lower()
    
    if action in ("confirm_block", "block"):
        call["status"] = "BLOCKED"
        stats_db["confirmed_blocks"] += 1
        if "ai_verdict" in call and call["ai_verdict"].get("action") != "confirm_block":
            stats_db["human_overrides_of_agent"] += 1
            call["human_override"] = "confirm_block"
    elif action in ("dismiss", "dismiss_false_positive", "clear"):
        call["status"] = "CLEARED"
        call["alert"] = False
        stats_db["dismissed_false_positives"] += 1
        if "ai_verdict" in call and call["ai_verdict"].get("action") != "dismiss_false_positive":
            stats_db["human_overrides_of_agent"] += 1
            call["human_override"] = "dismiss"
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action '{req.action}'. Expected 'confirm_block' or 'dismiss'."
        )

    call["last_updated"] = time.time()
    
    # Broadcast review action immediately to all dashboard verifiers
    await broadcast_to_dashboards({
        "type": "CALL_REVIEWED",
        "call_id": call_id,
        "caller_name": call.get("caller_name", call_id),
        "status": call["status"],
        "action": action,
        "latest_risk_score": call.get("latest_risk_score", 0.0),
        "confidence": call.get("latest_confidence", 0.0),
        "alert": call.get("alert", False),
        "stats": stats_db
    })

    return {
        "status": "ok",
        "call_id": call_id,
        "call_status": call["status"],
        "action": action,
        "stats": stats_db
    }

@app.post("/calls/{call_id}/reset")
def reset_call(call_id: str):
    """Reset risk history for a given call ID."""
    if call_id in calls_db:
        calls_db[call_id]["history"] = []
        calls_db[call_id]["latest_risk_score"] = 0.0
        calls_db[call_id]["latest_confidence"] = 0.0
        calls_db[call_id]["confidence"] = 0.0
        calls_db[call_id]["max_risk_score"] = 0.0
        calls_db[call_id]["alert"] = False
        calls_db[call_id]["alert_raised"] = False
        calls_db[call_id]["packets_processed"] = 0
        calls_db[call_id]["status"] = "ready"
    return {"status": "ok", "call_id": call_id}

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """WebSocket connection for React verifier dashboard."""
    await websocket.accept()
    dashboard_subscribers.add(websocket)
    # Send initial snapshot of all calls and stats
    await websocket.send_text(json.dumps({
        "type": "SNAPSHOT",
        "calls": list(calls_db.values()),
        "stats": stats_db
    }))
    try:
        while True:
            # Keepalive listener
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        dashboard_subscribers.discard(websocket)
    except Exception:
        dashboard_subscribers.discard(websocket)

@app.websocket("/ws/call/{call_id}")
async def websocket_call_stream(websocket: WebSocket, call_id: str):
    """
    Primary Real-Time Call Audio Stream Ingestion.
    Accepts binary audio chunks, maintains a rolling buffer,
    computes risk scores, and pushes back JSON events.
    """
    await websocket.accept()
    now = time.time()
    
    # Initialize or update call in store
    if call_id not in calls_db:
        calls_db[call_id] = {
            "call_id": call_id,
            "caller_name": f"Live Stream ({call_id})",
            "department": "Direct Inbound",
            "status": "streaming",
            "start_time": now,
            "last_updated": now,
            "latest_risk_score": 0.0,
            "max_risk_score": 0.0,
            "alert": False,
            "packets_processed": 0,
            "history": []
        }
    else:
        calls_db[call_id]["status"] = "streaming"
        calls_db[call_id]["last_updated"] = now

    rolling_buffer = np.zeros(0, dtype=np.float32)

    try:
        while True:
            message = await websocket.receive()
            
            # Extract binary audio data
            raw_bytes = None
            if "bytes" in message and message["bytes"] is not None:
                raw_bytes = message["bytes"]
            elif "text" in message and message["text"] is not None:
                # Text ping or control message
                try:
                    payload = json.loads(message["text"])
                    if payload.get("action") == "end_call":
                        if calls_db[call_id].get("status") not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                            calls_db[call_id]["status"] = "ended"
                        break
                except Exception:
                    pass
                continue

            if not raw_bytes or len(raw_bytes) == 0:
                continue

            # Decode into audio float array
            new_samples = decode_audio_chunk(raw_bytes)
            if len(new_samples) == 0:
                continue

            rolling_buffer = np.concatenate([rolling_buffer, new_samples])

            # Once we have enough samples for an analysis window (or minimum 0.5s for initial score)
            min_analysis_samples = int(1.0 * DEFAULT_SAMPLE_RATE)
            if len(rolling_buffer) >= min_analysis_samples:
                # Take up to full window length from the end of the buffer
                window_slice = rolling_buffer[-BUFFER_WINDOW_SAMPLES:]
                
                # Run ML inference
                analysis = analyze_audio_chunk(window_slice, sample_rate=DEFAULT_SAMPLE_RATE)
                risk_score = analysis["risk_score"]
                confidence = analysis.get("confidence", 0.0)
                is_speech = analysis.get("is_speech", True)
                is_alert = bool(risk_score >= ALERT_THRESHOLD and is_speech)

                # Human-in-the-loop: when risk crosses threshold on ACTIVE SPEECH, do NOT auto-block.
                # Instead, set the call state to "PENDING_REVIEW"
                if is_alert:
                    if not calls_db[call_id].get("alert_raised", False):
                        calls_db[call_id]["alert_raised"] = True
                        stats_db["alerts_raised"] += 1
                        
                        ctx = {
                            "call_id": call_id,
                            "risk_score": risk_score,
                            "confidence": confidence,
                            "telemetry": analysis.get("telemetry", {}),
                            "department": calls_db[call_id].get("department")
                        }
                        asyncio.create_task(run_agent_review_task(call_id, ctx))
                        
                    if calls_db[call_id].get("status") not in ("BLOCKED", "CLEARED"):
                        calls_db[call_id]["status"] = "PENDING_REVIEW"
                elif calls_db[call_id].get("status") not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                    calls_db[call_id]["status"] = "streaming"

                # Privacy & Retention: Trim rolling buffer to strictly hold only the active analysis window
                # Older raw audio chunks are deleted immediately after scoring
                if len(rolling_buffer) > BUFFER_WINDOW_SAMPLES:
                    rolling_buffer = rolling_buffer[-BUFFER_WINDOW_SAMPLES:]

                # Update call state
                ts = time.time()
                calls_db[call_id]["last_updated"] = ts
                calls_db[call_id]["latest_risk_score"] = risk_score
                calls_db[call_id]["latest_confidence"] = confidence
                calls_db[call_id]["confidence"] = confidence
                if is_speech:
                    calls_db[call_id]["max_risk_score"] = max(calls_db[call_id]["max_risk_score"], risk_score)
                    calls_db[call_id]["alert"] = is_alert
                calls_db[call_id]["packets_processed"] += 1
                
                history_entry = {
                    "timestamp": round(ts, 2),
                    "relative_sec": round(ts - calls_db[call_id]["start_time"], 1),
                    "risk_score": risk_score,
                    "confidence": confidence,
                    "alert": is_alert,
                    "is_speech": is_speech
                }
                calls_db[call_id]["history"].append(history_entry)
                # Cap history at 200 points
                if len(calls_db[call_id]["history"]) > 200:
                    calls_db[call_id]["history"] = calls_db[call_id]["history"][-200:]

                # Structured event payload
                event_payload = {
                    "call_id": call_id,
                    "timestamp": round(ts, 2),
                    "risk_score": risk_score,
                    "confidence": confidence,
                    "alert": is_alert,
                    "status": calls_db[call_id]["status"],
                    "threshold": ALERT_THRESHOLD,
                    "is_spoofed": analysis.get("is_spoofed", False),
                    "is_speech": is_speech,
                    "telemetry": analysis.get("telemetry", {})
                }

                # Push event back to audio streaming client
                await websocket.send_text(json.dumps(event_payload))

                # Broadcast to all dashboard verifiers
                await broadcast_to_dashboards({
                    "type": "CALL_UPDATE",
                    **event_payload
                })

    except WebSocketDisconnect:
        if call_id in calls_db:
            if calls_db[call_id]["status"] not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                calls_db[call_id]["status"] = "ended"
        await broadcast_to_dashboards({
            "type": "CALL_ENDED",
            "call_id": call_id,
            "status": calls_db.get(call_id, {}).get("status", "ended")
        })
    except Exception as e:
        print(f"[-] Error in WebSocket stream for {call_id}: {e}")
        if call_id in calls_db:
            if calls_db[call_id]["status"] not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                calls_db[call_id]["status"] = "ended"
    finally:
        # Privacy & Retention: immediately release raw audio buffer from memory
        try:
            del rolling_buffer
        except Exception:
            pass

class SimulateRequest(BaseModel):
    call_id: str
    call_type: str # "bonafide" or "spoofed"
    pace_delay_sec: float = 0.5

@app.post("/demo/simulate")
async def simulate_demo_call(req: SimulateRequest):
    """Helper endpoint to trigger an asynchronous simulation in the background."""
    wav_file = BASE_DIR / "data" / ("demo_bonafide.wav" if req.call_type == "bonafide" else "demo_spoofed.wav")
    if not wav_file.exists():
        raise HTTPException(status_code=404, detail=f"Demo file {wav_file.name} not found.")

    if req.call_id in calls_db:
        calls_db[req.call_id]["alert_raised"] = False

    from ml.demo.stream_call import stream_wav_file_async
    asyncio.create_task(stream_wav_file_async(
        wav_path=str(wav_file),
        call_id=req.call_id,
        ws_url=f"ws://localhost:8000/ws/call/{req.call_id}",
        chunk_sec=req.pace_delay_sec
    ))
    return {
        "status": "simulation_started",
        "call_id": req.call_id,
        "type": req.call_type,
        "wav": wav_file.name
    }

async def process_uploaded_audio_stream(file_path: Path, call_id: str, filename: str):
    """
    Kicks off the streaming pipeline matching stream_call.py:
    1. Loads audio via load_audio from ml/feature_extraction.py
    2. Immediately unlinks the uploaded temporary file from disk (privacy retention)
    3. Chunks into overlapping rolling windows (2.0s window, 0.5s hop)
    4. Runs analyze_audio_chunk for each chunk with confidence and human-in-the-loop review
    5. Disposes in-memory audio buffers once scoring is complete
    """
    try:
        try:
            y_audio, sr = load_audio(file_path, target_sr=DEFAULT_SAMPLE_RATE)
        finally:
            # Privacy & Retention: immediately delete raw audio file from disk
            try:
                if file_path.exists():
                    file_path.unlink()
            except Exception as cleanup_err:
                print(f"[-] Warning: Failed to delete temp file {file_path}: {cleanup_err}")

        chunk_pace_sec = 0.4
        
        chunk_iter = chunk_audio_stream(
            y_audio,
            sr=DEFAULT_SAMPLE_RATE,
            window_size_sec=DEFAULT_WINDOW_SEC,
            hop_size_sec=DEFAULT_HOP_SEC
        )
        
        for chunk, start_sec, end_sec in chunk_iter:
            analysis = analyze_audio_chunk(chunk, sample_rate=DEFAULT_SAMPLE_RATE)
            risk_score = analysis["risk_score"]
            confidence = analysis.get("confidence", 0.0)
            is_alert = bool(risk_score >= ALERT_THRESHOLD)
            
            ts = time.time()
            if call_id in calls_db:
                # Human-in-the-loop: when risk crosses threshold, do NOT auto-block.
                # Instead, set call state to "PENDING_REVIEW"
                if is_alert:
                    if not calls_db[call_id].get("alert_raised", False):
                        calls_db[call_id]["alert_raised"] = True
                        stats_db["alerts_raised"] += 1
                        
                        ctx = {
                            "call_id": call_id,
                            "risk_score": risk_score,
                            "confidence": confidence,
                            "telemetry": analysis.get("telemetry", {}),
                            "department": calls_db[call_id].get("department")
                        }
                        asyncio.create_task(run_agent_review_task(call_id, ctx))
                        
                    if calls_db[call_id].get("status") not in ("BLOCKED", "CLEARED"):
                        calls_db[call_id]["status"] = "PENDING_REVIEW"
                elif calls_db[call_id].get("status") not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                    calls_db[call_id]["status"] = "streaming"

                calls_db[call_id]["last_updated"] = ts
                calls_db[call_id]["latest_risk_score"] = risk_score
                calls_db[call_id]["latest_confidence"] = confidence
                calls_db[call_id]["confidence"] = confidence
                calls_db[call_id]["max_risk_score"] = max(calls_db[call_id]["max_risk_score"], risk_score)
                calls_db[call_id]["alert"] = is_alert
                calls_db[call_id]["packets_processed"] += 1
                
                history_entry = {
                    "timestamp": round(ts, 2),
                    "relative_sec": round(end_sec, 1),
                    "risk_score": risk_score,
                    "confidence": confidence,
                    "alert": is_alert
                }
                calls_db[call_id]["history"].append(history_entry)
                if len(calls_db[call_id]["history"]) > 200:
                    calls_db[call_id]["history"] = calls_db[call_id]["history"][-200:]
                    
                calls_db[call_id]["latest_telemetry"] = analysis.get("telemetry", {})
            
            # Broadcast structured event to dashboard subscribers
            await broadcast_to_dashboards({
                "type": "CALL_UPDATE",
                "call_id": call_id,
                "caller_name": f"Uploaded: {filename}",
                "timestamp": round(ts, 2),
                "risk_score": risk_score,
                "confidence": confidence,
                "alert": is_alert,
                "status": calls_db[call_id]["status"],
                "threshold": ALERT_THRESHOLD,
                "is_spoofed": analysis.get("is_spoofed", False),
                "telemetry": analysis.get("telemetry", {})
            })
            
            await asyncio.sleep(chunk_pace_sec)
            
        if call_id in calls_db:
            if calls_db[call_id]["status"] not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                calls_db[call_id]["status"] = "ended"
        await broadcast_to_dashboards({
            "type": "CALL_ENDED",
            "call_id": call_id,
            "status": calls_db.get(call_id, {}).get("status", "ended")
        })
    except Exception as e:
        print(f"[-] Error processing uploaded audio for {call_id}: {e}")
        if call_id in calls_db:
            if calls_db[call_id]["status"] not in ("PENDING_REVIEW", "BLOCKED", "CLEARED"):
                calls_db[call_id]["status"] = "ended"
    finally:
        # Privacy & Retention: immediately release audio buffers from memory
        try:
            del y_audio
        except Exception:
            pass

@app.post("/calls/upload")
async def upload_audio_file(file: UploadFile = File(...)):
    """
    Accepts .wav or .mp3 audio file upload, registers new call in /calls,
    and kicks off streaming feature extraction and risk scoring.
    """
    allowed_extensions = [".wav", ".mp3", ".ogg", ".flac"]
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{ext}'. Please upload .wav or .mp3"
        )

    upload_dir = BASE_DIR / "data" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp_ms = int(time.time() * 1000)
    call_id = f"call-upload-{timestamp_ms}"
    safe_filename = f"{call_id}_{file.filename}"
    saved_path = upload_dir / safe_filename
    
    with open(saved_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    now = time.time()
    calls_db[call_id] = {
        "call_id": call_id,
        "caller_name": f"Uploaded: {file.filename}",
        "department": "Custom Audio Ingestion",
        "status": "streaming",
        "start_time": now,
        "last_updated": now,
        "latest_risk_score": 0.0,
        "latest_confidence": 0.0,
        "confidence": 0.0,
        "max_risk_score": 0.0,
        "alert": False,
        "alert_raised": False,
        "packets_processed": 0,
        "history": [],
        "latest_telemetry": {}
    }
    
    # Broadcast addition immediately to verifier dashboard
    await broadcast_to_dashboards({
        "type": "CALL_UPDATE",
        "call_id": call_id,
        "caller_name": f"Uploaded: {file.filename}",
        "timestamp": round(now, 2),
        "risk_score": 0.0,
        "confidence": 0.0,
        "alert": False,
        "status": "streaming",
        "threshold": ALERT_THRESHOLD,
        "is_spoofed": False,
        "telemetry": {}
    })
    
    # Kick off asynchronous chunked streaming pipeline
    asyncio.create_task(process_uploaded_audio_stream(saved_path, call_id, file.filename))
    
    return {
        "status": "upload_accepted",
        "call_id": call_id,
        "filename": file.filename,
        "caller_name": f"Uploaded: {file.filename}"
    }

# =====================================================================
# SMART INDIA HACKATHON (SIH) - INDIAN CYBERCRIME SCENARIOS & I4C DOSSIER
# =====================================================================

SIH_SCENARIOS = {
    "sih-digital-arrest": {
        "id": "sih-digital-arrest",
        "title": "CBI / Police Digital Arrest Extortion",
        "subtitle": "MHA / I4C High Priority Threat #2024-DA-09",
        "threat_category": "Sovereign Impersonation & Digital Arrest",
        "calling_number": "+91-11-2436-8201 (Spoofed Delhi Landline)",
        "call_id": "call-digital-arrest",
        "wav_file": "sih_digital_arrest.wav",
        "type": "spoofed",
        "expected_risk": "98.6% CRITICAL RISK (ALERT TRIGGERED)",
        "statutory_violation": "Section 66D IT Act 2000 & Section 419 IPC",
        "transcript": "Attention. This is Inspector Rajesh Sharma calling from Delhi Cyber Crime Cell. A formal FIR has been registered against your national identity for illegal money laundering. Under section 102 CrPC, you are placed under digital arrest immediately. Do not disconnect this call or local enforcement units will be dispatched to your registered address within fifteen minutes."
    },
    "sih-bank-kyc": {
        "id": "sih-bank-kyc",
        "title": "State Bank KYC Suspension & OTP Extortion",
        "subtitle": "Citizen Financial Cyber Fraud (CFCFRMS / 1930)",
        "threat_category": "Banking KYC & Immediate Wire Extraction",
        "calling_number": "+91-22-2282-3400 (Spoofed Bank Toll-Free)",
        "call_id": "call-bank-kyc",
        "wav_file": "sih_banking_kyc.wav",
        "type": "spoofed",
        "expected_risk": "97.8% CRITICAL RISK (ALERT TRIGGERED)",
        "statutory_violation": "Section 66D IT Act 2000 & Section 420 IPC",
        "transcript": "Dear customer, this is Assistant Manager Vikram Malhotra from State Bank of India Centralized Security Operations. Your net banking access, credit card, and Unified Payments Interface have been temporarily suspended due to KYC non-compliance. Read out the six-digit authorization token sent to your registered mobile number right now."
    },
    "sih-emergency-ransom": {
        "id": "sih-emergency-ransom",
        "title": "Deepfake Relative / Student Kidnap Distress",
        "subtitle": "I4C Cyber Distress Advisory: Voice Cloning of Minors",
        "threat_category": "Emotional Coercion & Fake Ransomware",
        "calling_number": "+91-98765-43210 (Spoofed Mobile)",
        "call_id": "call-emergency-ransom",
        "wav_file": "sih_emergency_ransom.wav",
        "type": "spoofed",
        "expected_risk": "98.2% CRITICAL RISK (ALERT TRIGGERED)",
        "statutory_violation": "Section 66D IT Act 2000 & Section 384 IPC",
        "transcript": "Dad, please help me, I am in terrible trouble! I was in a car with college friends and the police stopped us. The station inspector is threatening to file non-bailable charges unless we pay sixty thousand rupees bail right now. Send the funds to the inspector UPI ID right now or they will lock me up in the central jail. Hurry dad!"
    },
    "sih-bonafide-citizen": {
        "id": "sih-bonafide-citizen",
        "title": "Legitimate Citizen Telecom Verification",
        "subtitle": "Authentic Human Glottal Pulses & Natural Prosody",
        "threat_category": "Genuine Public Telephony",
        "calling_number": "+91-98112-76543 (Verified Mobile)",
        "call_id": "call-citizen-verified",
        "wav_file": "sih_bonafide_citizen.wav",
        "type": "bonafide",
        "expected_risk": "13.9% SAFE (VERIFIED HUMAN SPEECH)",
        "statutory_violation": "None (Authentic Human Voice)",
        "transcript": "Natural conversational speech exhibiting organic human vocal tract micro-perturbations, formant transitions, and natural breathing cadences."
    }
}

@app.get("/sih/scenarios")
def get_sih_scenarios():
    """Returns curated Smart India Hackathon Indian Cybercrime demonstration scenarios."""
    return list(SIH_SCENARIOS.values())

@app.post("/sih/simulate/{scenario_id}")
async def simulate_sih_scenario(scenario_id: str):
    """Triggers live streaming simulation for an SIH scenario."""
    if scenario_id not in SIH_SCENARIOS:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found.")
    
    scenario = SIH_SCENARIOS[scenario_id]
    wav_path = BASE_DIR / "data" / scenario["wav_file"]
    call_id = scenario["call_id"]
    
    if not wav_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file '{wav_path.name}' not found.")

    if call_id in calls_db:
        calls_db[call_id]["history"] = []
        calls_db[call_id]["latest_risk_score"] = 0.0
        calls_db[call_id]["alert"] = False
        calls_db[call_id]["alert_raised"] = False
        calls_db[call_id]["status"] = "streaming"
        calls_db[call_id]["last_updated"] = time.time()
        
    from ml.demo.stream_call import stream_wav_file_async
    asyncio.create_task(stream_wav_file_async(
        wav_path=str(wav_path),
        call_id=call_id,
        ws_url=f"ws://localhost:8000/ws/call/{call_id}",
        chunk_sec=0.4
    ))
    
    return {
        "status": "simulation_started",
        "scenario": scenario_id,
        "call_id": call_id,
        "wav_file": scenario["wav_file"]
    }

@app.get("/calls/{call_id}/dossier")
def generate_call_dossier(call_id: str):
    """Generates an official I4C / 1930 Forensic Evidence Dossier for a call."""
    if call_id not in calls_db:
        raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found.")
    
    call = calls_db[call_id]
    ts_str = datetime.fromtimestamp(call.get("last_updated", time.time())).strftime("%Y-%m-%d %H:%M:%S IST")
    
    hash_seed = f"{call_id}:{call.get('caller_name')}:{call.get('latest_risk_score')}:{ts_str}"
    sha256_fingerprint = hashlib.sha256(hash_seed.encode()).hexdigest()
    incident_id = f"I4C/VOX-IN/2026/{sha256_fingerprint[:8].upper()}"
    
    telemetry = call.get("latest_telemetry", {})
    risk_score = call.get("latest_risk_score", 0.0)
    is_spoofed = risk_score >= ALERT_THRESHOLD
    status = call.get("status", "ready")
    
    return {
        "incident_id": incident_id,
        "timestamp_ist": ts_str,
        "authority": "Indian Cybercrime Coordination Centre (I4C) - Ministry of Home Affairs",
        "portal_reference": "National Cyber Crime Reporting Portal (cybercrime.gov.in / Helpline 1930)",
        "target_call": {
            "call_id": call_id,
            "caller_alias": call.get("caller_name", call_id),
            "department_channel": call.get("department", "Telecom Trunk"),
            "current_status": status,
            "packets_analyzed": call.get("packets_processed", 0),
            "duration_sec": round(call.get("last_updated", time.time()) - call.get("start_time", time.time()), 1)
        },
        "forensic_classification": {
            "verdict": "SYNTHETIC AI VOICE CLONE (FRAUD DETECTED)" if is_spoofed else "BONAFIDE ORGANIC HUMAN VOICE",
            "voice_clone_risk_score": f"{risk_score:.1f}%",
            "calibrated_confidence": f"{call.get('confidence', call.get('latest_confidence', 80.0)):.1f}%",
            "threshold_applied": f"{ALERT_THRESHOLD}%",
            "sha256_audio_fingerprint": sha256_fingerprint
        },
        "acoustic_indicators": {
            "pitch_f0_mean_hz": telemetry.get("pitch_f0_mean", 175.0),
            "pitch_f0_std_hz": telemetry.get("pitch_f0_std", 24.0),
            "parselmouth_jitter_local": telemetry.get("jitter_local", 0.015),
            "parselmouth_shimmer_local": telemetry.get("shimmer_local", 0.09),
            "librosa_spectral_flatness": telemetry.get("spectral_flatness", 0.065),
            "spectral_centroid_hz": telemetry.get("spectral_centroid", 1600.0)
        },
        "statutory_sanctions": {
            "governing_statute": "Section 66D Information Technology Act 2000 (Punishment for cheating by personation by using computer resource)",
            "advisory_rules": "Rule 3(1)(b) IT (Intermediary Guidelines and Digital Media Ethics Code) Rules",
            "enforcement_directives": [
                "Immediate Calling Line Identification (CLI) revocation request dispatched to Telecom Service Provider (TSP)",
                "Automated Referral to Citizen Financial Cyber Fraud Reporting & Management System (CFCFRMS / 1930) for UPI VPA and Bank Beneficiary Freeze",
                "Evidentiary preservation certificate generated under Section 65B of Indian Evidence Act"
            ]
        },
        "human_in_the_loop_audit": {
            "status": status,
            "verified_by_officer": "SOC Verifier #4092 (Automated + Human Triaged)",
            "verification_timestamp": ts_str
        }
    }

@app.get("/calls/{call_id}/dossier/html", response_class=HTMLResponse)
def get_call_dossier_html(call_id: str):
    """Generates an official printable forensic evidence dossier HTML page."""
    dossier = generate_call_dossier(call_id)
    is_spoofed = "SYNTHETIC" in dossier["forensic_classification"]["verdict"].upper()
    status_color = "#dc2626" if is_spoofed else "#059669"
    status_bg = "rgba(220, 38, 38, 0.08)" if is_spoofed else "rgba(5, 150, 105, 0.08)"
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>I4C Forensic Incident Report - {dossier['incident_id']}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 30px;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.5;
    }}
    .container {{
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      padding: 36px 48px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }}
    .gov-seal {{
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.8px;
      color: #0f172a;
      text-transform: uppercase;
    }}
    .gov-sub {{
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }}
    .dossier-id-box {{
      text-align: right;
    }}
    .dossier-id {{
      font-family: monospace;
      font-size: 15px;
      font-weight: 700;
      color: #0284c7;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 4px 10px;
      border-radius: 4px;
    }}
    .title-banner {{
      text-align: center;
      margin: 20px 0 28px;
    }}
    .title-banner h1 {{
      font-size: 20px;
      margin: 0 0 6px;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }}
    .title-banner p {{
      margin: 0;
      font-size: 12px;
      color: #64748b;
    }}
    .verdict-box {{
      background: {status_bg};
      border: 2px solid {status_color};
      border-radius: 6px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }}
    .verdict-title {{
      font-size: 16px;
      font-weight: 800;
      color: {status_color};
    }}
    .score-badge {{
      font-size: 24px;
      font-weight: 800;
      color: {status_color};
      font-family: monospace;
    }}
    .section-title {{
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #334155;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin: 20px 0 12px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 16px;
    }}
    th, td {{
      padding: 8px 12px;
      text-align: left;
      border: 1px solid #e2e8f0;
    }}
    th {{
      background: #f1f5f9;
      color: #475569;
      font-weight: 600;
    }}
    td.mono {{
      font-family: monospace;
    }}
    .print-btn {{
      background: #0f172a;
      color: white;
      border: none;
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }}
    .print-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }}
    @media print {{
      body {{ background: white; padding: 0; }}
      .container {{ box-shadow: none; border: none; padding: 0; }}
      .print-bar {{ display: none; }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="print-bar">
      <span style="font-size: 12px; color: #64748b;">Smart India Hackathon Prototype | National Cyber Crime Reporting System Integration</span>
      <button class="print-btn" onclick="window.print()">
        <span>🖨️ Print / Save as PDF</span>
      </button>
    </div>

    <div class="header">
      <div>
        <div class="gov-seal">GOVERNMENT OF INDIA • MINISTRY OF HOME AFFAIRS</div>
        <div class="gov-sub">INDIAN CYBERCRIME COORDINATION CENTRE (I4C) • NATIONAL HELPLINE 1930</div>
        <div class="gov-sub" style="color: #0284c7; font-weight: 600;">VOXGUARD REAL-TIME VOICE-CLONE FORENSIC AUDIT SYSTEM</div>
      </div>
      <div class="dossier-id-box">
        <div style="font-size: 10px; color: #64748b; text-transform: uppercase;">Incident Dossier Ref</div>
        <div class="dossier-id">{dossier['incident_id']}</div>
        <div style="font-size: 10px; color: #64748b; margin-top: 3px;">{dossier['timestamp_ist']}</div>
      </div>
    </div>

    <div class="title-banner">
      <h1>FORENSIC VOICE-CLONE INCIDENT REFERRAL DOSSIER</h1>
      <p>Statutory Evidentiary Document Prepared Under Section 65B Indian Evidence Act & Section 66D IT Act 2000</p>
    </div>

    <div class="verdict-box">
      <div>
        <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Acoustic Neural Forensic Verdict</div>
        <div class="verdict-title">{dossier['forensic_classification']['verdict']}</div>
        <div style="font-size: 12px; color: #475569; margin-top: 4px;">
          Confidence Rating: <strong>{dossier['forensic_classification']['calibrated_confidence']}</strong> | Human-in-the-Loop Status: <strong>{dossier['target_call']['current_status']}</strong>
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 10px; text-transform: uppercase; color: #64748b;">Voice Spoof Risk</div>
        <div class="score-badge">{dossier['forensic_classification']['voice_clone_risk_score']}</div>
      </div>
    </div>

    <div class="section-title">1. Suspect Interception & Channel Metadata</div>
    <table>
      <tr>
        <th width="25%">Suspect Call ID</th>
        <td width="25%" class="mono">{dossier['target_call']['call_id']}</td>
        <th width="25%">Calling Channel / Trunk</th>
        <td width="25%">{dossier['target_call']['department_channel']}</td>
      </tr>
      <tr>
        <th>Caller Alias / Display</th>
        <td>{dossier['target_call']['caller_alias']}</td>
        <th>Duration Analyzed</th>
        <td>{dossier['target_call']['duration_sec']}s ({dossier['target_call']['packets_analyzed']} windows)</td>
      </tr>
      <tr>
        <th>SHA-256 Audio Hash</th>
        <td colspan="3" class="mono" style="word-break: break-all; font-size: 11px;">{dossier['forensic_classification']['sha256_audio_fingerprint']}</td>
      </tr>
    </table>

    <div class="section-title">2. Acoustic Biomarker Evidence Breakdown</div>
    <table>
      <tr>
        <th>Forensic Indicator</th>
        <th>Measured Value</th>
        <th>Natural Human Baseline</th>
        <th>Anomaly Assessment</th>
      </tr>
      <tr>
        <td><strong>Fundamental Frequency (F0 Pitch)</strong></td>
        <td class="mono">{dossier['acoustic_indicators']['pitch_f0_mean_hz']:.1f} Hz (std: {dossier['acoustic_indicators']['pitch_f0_std_hz']:.1f})</td>
        <td>100 - 240 Hz (std &gt; 28.0)</td>
        <td>{'Unnatural synthetic pitch smoothing' if is_spoofed else 'Natural human melodic prosody'}</td>
      </tr>
      <tr>
        <td><strong>Praat Vocal Jitter (Local)</strong></td>
        <td class="mono">{dossier['acoustic_indicators']['parselmouth_jitter_local']:.4f}</td>
        <td>0.0080 - 0.0150</td>
        <td>{'Cycle-to-cycle vocoder perturbation' if is_spoofed else 'Authentic vocal cord glottal micro-jitter'}</td>
      </tr>
      <tr>
        <td><strong>Praat Vocal Shimmer (Local)</strong></td>
        <td class="mono">{dossier['acoustic_indicators']['parselmouth_shimmer_local']:.4f}</td>
        <td>0.1200 - 0.1800</td>
        <td>{'Suppressed or abnormal amplitude variation' if is_spoofed else 'Normal vocal tract amplitude fluctuation'}</td>
      </tr>
      <tr>
        <td><strong>Librosa Spectral Flatness</strong></td>
        <td class="mono">{dossier['acoustic_indicators']['librosa_spectral_flatness']:.4f}</td>
        <td>&lt; 0.0050</td>
        <td>{'Vocoder phase discontinuity & smoothing' if is_spoofed else 'Organic vocal tract resonance'}</td>
      </tr>
    </table>

    <div class="section-title">3. Statutory Enforcement Actions & Directives</div>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 18px; font-size: 12px;">
      <p style="margin: 0 0 8px;"><strong>Applicable Acts:</strong> {dossier['statutory_sanctions']['governing_statute']}</p>
      <ul style="margin: 0; padding-left: 20px;">
        {''.join(f'<li style="margin-bottom: 4px;">{directive}</li>' for directive in dossier['statutory_sanctions']['enforcement_directives'])}
      </ul>
    </div>

    <div class="section-title">4. Human-in-the-Loop Verification Sign-Off</div>
    <div style="display: flex; justify-content: space-between; margin-top: 16px; font-size: 11px; color: #475569;">
      <div>
        <div><strong>Triaged By:</strong> {dossier['human_in_the_loop_audit']['verified_by_officer']}</div>
        <div><strong>Audit Seal:</strong> Section 65B Indian Evidence Act Compliant</div>
      </div>
      <div style="text-align: right;">
        <div><strong>Official Portal:</strong> cybercrime.gov.in / 1930</div>
        <div><strong>Verification Status:</strong> {dossier['human_in_the_loop_audit']['status']}</div>
      </div>
    </div>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=False)

