#!/usr/bin/env python3
"""
VoxGuard - Real-Time Inference Module

Loads the serialized model artifact (ml/artifacts/model.pkl) and exposes:
- score_audio_chunk(audio_array, sample_rate) -> risk_score (0-100 float)
- analyze_audio_chunk(audio_array, sample_rate) -> dict with risk score, telemetry & forensic indicators
"""

import os
import sys
import numpy as np
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from ml.feature_extraction import extract_features, DEFAULT_SAMPLE_RATE, compute_rms, is_speech_active
from ml.model import VoxGuardClassifier

MODEL_PATH = BASE_DIR / "ml" / "artifacts" / "model.pkl"

_DETECTOR_INSTANCE = None

class ScoreResult(dict):
    """
    Score result container providing dictionary access, attribute access,
    and tuple unpacking (risk_score, confidence).
    """
    def __init__(self, risk_score: float, confidence: float):
        super().__init__(risk_score=risk_score, confidence=confidence)
        self.risk_score = risk_score
        self.confidence = confidence

    def __iter__(self):
        yield self.risk_score
        yield self.confidence

    def __getitem__(self, item):
        if isinstance(item, int):
            return (self.risk_score, self.confidence)[item]
        return super().__getitem__(item)

class VoiceCloneDetector:
    """Thread-safe detector loading model.pkl and scoring live audio chunks."""
    def __init__(self, model_path=MODEL_PATH):
        self.model_path = Path(model_path)
        self.classifier = None
        self._load_or_init_model()

    def _load_or_init_model(self):
        """Load trained model or auto-train if missing."""
        if self.model_path.exists():
            try:
                self.classifier = VoxGuardClassifier.load(self.model_path)
                print(f"[VoxGuard] Successfully loaded model from {self.model_path}")
                return
            except Exception as e:
                print(f"[-] Error loading model from {self.model_path}: {e}")

        # If model does not exist or failed to load, train baseline model
        print("[!] No trained model found. Executing automatic baseline training...")
        from ml.train import train_and_evaluate
        train_and_evaluate()
        self.classifier = VoxGuardClassifier.load(self.model_path)

    def score_audio_chunk(self, audio_array, sample_rate=DEFAULT_SAMPLE_RATE) -> ScoreResult:
        """
        Evaluate a single audio chunk and return both Voice Clone Risk Score (0-100)
        and Confidence Score (0-100).
        """
        if self.classifier is None:
            self._load_or_init_model()

        if not is_speech_active(audio_array, sr=sample_rate):
            return ScoreResult(risk_score=0.0, confidence=0.0)

        # Extract features
        features = extract_features(audio_array, sr=sample_rate)
        
        # Calculate risk score and confidence
        score, confidence = self.classifier.calculate_risk_and_confidence(features.reshape(1, -1))
        return ScoreResult(risk_score=round(float(score), 1), confidence=round(float(confidence), 1))

    def analyze_audio_chunk(self, audio_array, sample_rate=DEFAULT_SAMPLE_RATE) -> dict:
        """
        Full forensic analysis returning risk score, confidence, alert status, and acoustic telemetry.
        Includes Voice Activity Detection (VAD) gating to prevent false positives on silence/ambient noise.
        """
        if self.classifier is None:
            self._load_or_init_model()

        rms = compute_rms(audio_array)
        speech_active = is_speech_active(audio_array, sr=sample_rate)

        if not speech_active:
            telemetry = {
                "spectral_flatness": 0.0,
                "spectral_centroid": 0.0,
                "pitch_f0_mean": 0.0,
                "pitch_f0_std": 0.0,
                "jitter_local": 0.0,
                "shimmer_local": 0.0,
                "rms_energy": round(float(rms), 4)
            }
            print(f"[VoxGuard Inference] VAD Gate: Non-speech / ambient noise (RMS: {rms:.4f}) -> Risk: 0.0% | Alert: False")
            return {
                "risk_score": 0.0,
                "confidence": 0.0,
                "alert": False,
                "is_spoofed": False,
                "is_speech": False,
                "telemetry": telemetry
            }

        features = extract_features(audio_array, sr=sample_rate)
        score, confidence = self.classifier.calculate_risk_and_confidence(features.reshape(1, -1))
        score = round(float(score), 1)
        confidence = round(float(confidence), 1)

        # Telemetry metrics for forensic inspection in verifier dashboard
        # Features map:
        # [0..77]: MFCCs
        # [78..99]: Spectral Flatness, Contrast, Centroid, Rolloff, ZCR
        # [100..110]: Pitch F0, Jitter, Shimmer
        telemetry = {}
        try:
            telemetry["spectral_flatness"] = round(float(features[78]), 4)
            telemetry["spectral_centroid"] = round(float(features[94]), 1)
            telemetry["pitch_f0_mean"] = round(float(features[100]), 1)
            telemetry["pitch_f0_std"] = round(float(features[101]), 2)
            telemetry["jitter_local"] = round(float(features[105]), 5)
            telemetry["shimmer_local"] = round(float(features[108]), 4)
            telemetry["rms_energy"] = round(float(rms), 4)
        except IndexError:
            pass

        is_alert = bool(score >= 70.0)
        print(f"[VoxGuard Inference] Window Analysis | RMS: {rms:.4f} | F0: {telemetry.get('pitch_f0_mean', 0.0)}Hz | Jitter: {telemetry.get('jitter_local', 0.0):.5f} | Flatness: {telemetry.get('spectral_flatness', 0.0):.4f} -> Risk: {score}% | Alert: {is_alert}")

        return {
            "risk_score": score,
            "confidence": confidence,
            "alert": is_alert,
            "is_spoofed": bool(score >= 50.0),
            "is_speech": True,
            "telemetry": telemetry
        }

def get_detector() -> VoiceCloneDetector:
    """Singleton getter for VoiceCloneDetector."""
    global _DETECTOR_INSTANCE
    if _DETECTOR_INSTANCE is None:
        _DETECTOR_INSTANCE = VoiceCloneDetector()
    return _DETECTOR_INSTANCE

def score_audio_chunk(audio_array, sample_rate=DEFAULT_SAMPLE_RATE) -> ScoreResult:
    """Convenience function returning both risk_score and confidence."""
    detector = get_detector()
    return detector.score_audio_chunk(audio_array, sample_rate)

def analyze_audio_chunk(audio_array, sample_rate=DEFAULT_SAMPLE_RATE) -> dict:
    """Convenience function returning full analysis with risk score and confidence."""
    detector = get_detector()
    return detector.analyze_audio_chunk(audio_array, sample_rate)


if __name__ == "__main__":
    detector = get_detector()
    test_tone = np.sin(2 * np.pi * 120 * np.linspace(0, 2, 32000)).astype(np.float32)
    res = detector.analyze_audio_chunk(test_tone, sample_rate=16000)
    print(f"[VoxGuard] Test Audio Chunk Analysis:")
    print(f"  Risk Score: {res['risk_score']} / 100 (Alert: {res['alert']})")
    print(f"  Telemetry: {res['telemetry']}")
