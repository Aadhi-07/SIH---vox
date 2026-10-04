#!/usr/bin/env python3
"""
VoxGuard - End-to-End Real-Time Call Audio Streaming Simulation

Streams a WAV audio file over WebSocket to ws://localhost:8000/ws/call/{call_id}
in real-time paced chunks (default: 0.5s per chunk), simulating a live incoming phone call.
Concurrently receives live Risk Scores (0-100) and displays a real-time terminal HUD.

Usage:
  # Stream genuine executive call:
  python ml/demo/stream_call.py --type bonafide --call-id call-marcus-cfo

  # Stream cloned fraud attempt:
  python ml/demo/stream_call.py --type spoofed --call-id call-fraud-override
"""

import os
import sys
import time
import math
import wave
import json
import asyncio
import argparse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"

DEFAULT_WS_HOST = "localhost:8000"
BONAFIDE_WAV = DATA_DIR / "demo_bonafide.wav"
SPOOFED_WAV = DATA_DIR / "demo_spoofed.wav"

def render_risk_meter(score: float, width: int = 24) -> str:
    """Render high-contrast ASCII risk bar."""
    filled = int(round((score / 100.0) * width))
    filled = max(0, min(width, filled))
    bar = "█" * filled + "░" * (width - filled)
    
    if score >= 70.0:
        status = "\033[91m[CRITICAL: FRAUD CLONE DETECTED]\033[0m"
    elif score >= 40.0:
        status = "\033[93m[SUSPICIOUS: ANOMALY PRESENT]\033[0m"
    else:
        status = "\033[92m[GENUINE HUMAN SPEECH]\033[0m"
        
    return f"[{bar}] {score:5.1f}% {status}"

async def stream_wav_file_async(wav_path: str, call_id: str, ws_url: str = None, chunk_sec: float = 0.5, verbose: bool = True):
    """
    Asynchronously streams WAV audio chunks over WebSocket at real-time pace.
    """
    import websockets

    if not ws_url:
        ws_url = f"ws://{DEFAULT_WS_HOST}/ws/call/{call_id}"

    wav_file = Path(wav_path)
    if not wav_file.exists():
        raise FileNotFoundError(f"Audio file not found: {wav_file}")

    with wave.open(str(wav_file), "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        duration_sec = n_frames / float(framerate)
        raw_audio_bytes = wf.readframes(n_frames)

    chunk_frames = int(framerate * chunk_sec)
    bytes_per_frame = n_channels * sampwidth
    chunk_bytes_len = chunk_frames * bytes_per_frame
    total_chunks = math.ceil(len(raw_audio_bytes) / chunk_bytes_len)

    if verbose:
        print("\n" + "=" * 70)
        print(f"  VOXGUARD REAL-TIME CALL STREAM SIMULATOR")
        print("=" * 70)
        print(f"  Call ID:       {call_id}")
        print(f"  Audio Source:  {wav_file.name} ({duration_sec:.2f}s, {framerate}Hz, {n_channels}ch)")
        print(f"  WebSocket URL: {ws_url}")
        print(f"  Chunk Size:    {chunk_sec}s ({chunk_bytes_len} bytes) | Total Packets: {total_chunks}")
        print("-" * 70)

    try:
        async with websockets.connect(ws_url) as ws:
            stats = {
                "scores": [],
                "alerts_triggered": 0,
                "packets_sent": 0
            }

            async def receive_scores():
                try:
                    while True:
                        msg = await ws.recv()
                        data = json.loads(msg)
                        score = data.get("risk_score", 0.0)
                        conf = data.get("confidence", 0.0)
                        alert = data.get("alert", False)
                        stats["scores"].append(score)
                        if alert:
                            stats["alerts_triggered"] += 1
                        
                        if verbose:
                            t_offset = (stats["packets_sent"]) * chunk_sec
                            meter = render_risk_meter(score)
                            conf_str = f" (Conf: {conf:.1f}%)" if conf else ""
                            f_info = ""
                            if "telemetry" in data and data["telemetry"]:
                                f_std = data["telemetry"].get("pitch_f0_std", 0)
                                f_flat = data["telemetry"].get("spectral_flatness", 0)
                                f_info = f" | F0 std: {f_std}Hz, Flatness: {f_flat}"
                            print(f"  [T+{t_offset:4.1f}s] {meter}{conf_str}{f_info}")
                except asyncio.CancelledError:
                    pass
                except websockets.exceptions.ConnectionClosed:
                    pass

            # Start background listener for returned scores
            listener_task = asyncio.create_task(receive_scores())

            # Stream chunks with real-time sleep
            for i in range(total_chunks):
                start = i * chunk_bytes_len
                end = min(start + chunk_bytes_len, len(raw_audio_bytes))
                chunk_data = raw_audio_bytes[start:end]

                await ws.send(chunk_data)
                stats["packets_sent"] += 1
                await asyncio.sleep(chunk_sec)

            # Give a brief moment for final packets to be processed
            await asyncio.sleep(1.0)
            listener_task.cancel()

            # End call
            try:
                await ws.send(json.dumps({"action": "end_call"}))
            except Exception:
                pass

            if verbose:
                print("-" * 70)
                avg_score = (sum(stats["scores"]) / len(stats["scores"])) if stats["scores"] else 0.0
                max_score = max(stats["scores"]) if stats["scores"] else 0.0
                print(f"  STREAM FINISHED.")
                print(f"  Packets Sent: {stats['packets_sent']}")
                print(f"  Average Risk Score: {avg_score:.1f}% | Peak Risk Score: {max_score:.1f}%")
                if stats["alerts_triggered"] > 0:
                    print(f"  \033[91m[ALERT SUMMARY] Triggered {stats['alerts_triggered']} High-Risk Fraud Alerts!\033[0m")
                else:
                    print(f"  \033[92m[ALERT SUMMARY] Clean Call. No Fraud Alerts Triggered.\033[0m")
                print("=" * 70 + "\n")

            return stats

    except Exception as e:
        print(f"[-] Connection error: {e}")
        print("    Make sure the FastAPI server is running: python -m uvicorn api.main:app --port 8000")
        return None

def main():
    parser = argparse.ArgumentParser(description="VoxGuard Real-Time Audio Stream Simulator")
    parser.add_argument("--type", choices=["bonafide", "spoofed"], default=None, help="Preset call type (bonafide or spoofed)")
    parser.add_argument("--wav", type=str, default=None, help="Path to custom WAV audio file")
    parser.add_argument("--call-id", type=str, default=None, help="Custom Call ID identifier")
    parser.add_argument("--chunk-sec", type=float, default=0.5, help="Audio chunk size in seconds")
    parser.add_argument("--host", type=str, default="localhost:8000", help="FastAPI host:port")
    args = parser.parse_args()

    # Determine audio file
    if args.type == "bonafide":
        wav_path = BONAFIDE_WAV
        call_id = args.call_id or f"call-human-{int(time.time()) % 1000}"
    elif args.type == "spoofed":
        wav_path = SPOOFED_WAV
        call_id = args.call_id or f"call-clone-{int(time.time()) % 1000}"
    elif args.wav:
        wav_path = Path(args.wav)
        call_id = args.call_id or f"call-custom-{int(time.time()) % 1000}"
    else:
        # Default prompt
        print("[!] No audio specified. Defaulting to 'bonafide' call.")
        wav_path = BONAFIDE_WAV
        call_id = "call-demo-01"

    ws_url = f"ws://{args.host}/ws/call/{call_id}"
    asyncio.run(stream_wav_file_async(
        wav_path=str(wav_path),
        call_id=call_id,
        ws_url=ws_url,
        chunk_sec=args.chunk_sec,
        verbose=True
    ))

if __name__ == "__main__":
    main()
