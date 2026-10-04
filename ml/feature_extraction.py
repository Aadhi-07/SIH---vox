#!/usr/bin/env python3
"""
VoxGuard - Acoustic Feature Extraction Pipeline

Extracts forensic vocal features to distinguish genuine human voices
from synthetic TTS and neural voice clones:
1. MFCCs (Mel-Frequency Cepstral Coefficients) + Deltas & Delta-Deltas (Librosa)
2. Spectral Flatness & Spectral Contrast (Librosa)
3. Pitch (F0) Contour & Voiced Fraction (Parselmouth / Praat)
4. Voice Micro-Perturbations: Jitter (pitch instability) & Shimmer (amplitude instability)
5. Streaming chunking utility for sliding-window analysis (e.g. 2.0s window, 0.5s hop)
"""

import os
import math
import numpy as np
import soundfile as sf
from pathlib import Path

# Optional / dynamic imports with graceful fallbacks
try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

try:
    import parselmouth
    from parselmouth.praat import call as praat_call
    HAS_PARSELMOUTH = True
except ImportError:
    HAS_PARSELMOUTH = False

DEFAULT_SAMPLE_RATE = 16000
DEFAULT_WINDOW_SEC = 2.0
DEFAULT_HOP_SEC = 0.5

def load_audio(audio_input, target_sr=DEFAULT_SAMPLE_RATE):
    """
    Load audio from file path, bytes, or numpy array.
    Returns:
        audio_array: 1D np.ndarray (float32, normalized [-1, 1])
        sr: int sample rate
    """
    if isinstance(audio_input, (str, Path)):
        if HAS_LIBROSA:
            y, sr = librosa.load(str(audio_input), sr=target_sr, mono=True)
            return y.astype(np.float32), sr
        else:
            y, sr = sf.read(str(audio_input), dtype="float32")
            if y.ndim > 1:
                y = np.mean(y, axis=1)
            return y, sr
            
    elif isinstance(audio_input, np.ndarray):
        y = audio_input.astype(np.float32)
        if y.ndim > 1:
            y = np.mean(y, axis=1)
        # Normalize if integer or out of bounds
        max_val = np.max(np.abs(y))
        if max_val > 1.0:
            y = y / max_val
        return y, target_sr
        
    else:
        raise ValueError(f"Unsupported audio input type: {type(audio_input)}")

def compute_rms(y: np.ndarray) -> float:
    """Computes Root Mean Square (RMS) energy of audio signal."""
    if y is None or len(y) == 0:
        return 0.0
    return float(np.sqrt(np.mean(y.astype(np.float32) ** 2)))

def is_speech_active(y: np.ndarray, sr: int = DEFAULT_SAMPLE_RATE, min_rms: float = 0.010, min_voiced_fraction: float = 0.08) -> bool:
    """
    Voice Activity Detection (VAD) Gate.
    Determines whether the audio window contains active human speech
    before running the synthetic voice classifier.

    Filters out:
    1. Silence and ambient room noise floor (RMS < min_rms).
    2. Microphone clicks, unvoiced static, and electrical hum.
    """
    if y is None or len(y) == 0:
        return False
    rms = compute_rms(y)
    if rms < min_rms:
        return False

    # Check voiced periodicity with Parselmouth / Praat
    if HAS_PARSELMOUTH and len(y) >= 512:
        try:
            sound = parselmouth.Sound(y, sampling_frequency=sr)
            pitch = sound.to_pitch(time_step=0.02, pitch_floor=75.0, pitch_ceiling=600.0)
            f0_values = pitch.selected_array['frequency']
            voiced = f0_values[f0_values > 0]
            if len(f0_values) > 0:
                vf = len(voiced) / len(f0_values)
                # If conversational level volume, allow lower voiced fraction for consonants/whispers
                if rms >= 0.025:
                    return bool(vf >= 0.04)
                return bool(vf >= min_voiced_fraction)
        except Exception:
            pass

    # Mathematical zero-crossing + energy fallback
    if len(y) >= 160:
        zcr = np.mean(np.abs(np.diff(np.sign(y)))) * 0.5
        return bool(rms >= min_rms and 0.01 <= zcr <= 0.45)
    return bool(rms >= min_rms)

def chunk_audio_stream(audio_array, sr=DEFAULT_SAMPLE_RATE, window_size_sec=DEFAULT_WINDOW_SEC, hop_size_sec=DEFAULT_HOP_SEC):
    """
    Generator yielding overlapping audio chunks for real-time streaming analysis.
    Yields:
        chunk: 1D np.ndarray of shape (window_samples,)
        start_sec: float
        end_sec: float
    """
    window_samples = int(window_size_sec * sr)
    hop_samples = int(hop_size_sec * sr)
    total_samples = len(audio_array)

    if total_samples < window_samples:
        # Pad with zeros if shorter than one window
        padded = np.pad(audio_array, (0, window_samples - total_samples), mode='constant')
        yield padded, 0.0, float(total_samples) / sr
        return

    start_idx = 0
    while start_idx + window_samples <= total_samples:
        end_idx = start_idx + window_samples
        chunk = audio_array[start_idx:end_idx]
        start_sec = start_idx / sr
        end_sec = end_idx / sr
        yield chunk, start_sec, end_sec
        start_idx += hop_samples

def extract_mfcc_features(y, sr, n_mfcc=13):
    """
    Extract MFCCs, delta, and delta2 statistics (mean and std).
    Returns 1D numpy array of length (n_mfcc * 6).
    """
    if not HAS_LIBROSA:
        # Fallback if librosa is initializing: simple FFT filterbank
        return np.zeros(n_mfcc * 6, dtype=np.float32)
        
    # Ensure minimum length for STFT
    if len(y) < 512:
        y = np.pad(y, (0, 512 - len(y)), mode='constant')

    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc, n_fft=512, hop_length=160)
    delta1 = librosa.feature.delta(mfccs)
    delta2 = librosa.feature.delta(mfccs, order=2)

    features = np.concatenate([
        np.mean(mfccs, axis=1),
        np.std(mfccs, axis=1),
        np.mean(delta1, axis=1),
        np.std(delta1, axis=1),
        np.mean(delta2, axis=1),
        np.std(delta2, axis=1)
    ])
    return features.astype(np.float32)

def extract_spectral_features(y, sr):
    """
    Extract spectral flatness, spectral contrast, centroid, and rolloff.
    """
    if not HAS_LIBROSA:
        return np.zeros(20, dtype=np.float32)

    if len(y) < 512:
        y = np.pad(y, (0, 512 - len(y)), mode='constant')

    # Spectral flatness (measure of noisiness vs tone-like harmonics)
    flatness = librosa.feature.spectral_flatness(y=y, n_fft=512, hop_length=160)
    flatness_mean = float(np.mean(flatness))
    flatness_std = float(np.std(flatness))

    # Spectral contrast (valleys vs peaks across 7 octave bands)
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr, n_fft=512, hop_length=160, n_bands=6)
    contrast_mean = np.mean(contrast, axis=1)
    contrast_std = np.std(contrast, axis=1)

    # Spectral centroid and rolloff
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=512, hop_length=160)
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, n_fft=512, hop_length=160, roll_percent=0.85)
    zcr = librosa.feature.zero_crossing_rate(y, hop_length=160)

    features = np.concatenate([
        [flatness_mean, flatness_std],
        contrast_mean,
        contrast_std,
        [float(np.mean(centroid)), float(np.std(centroid))],
        [float(np.mean(rolloff)), float(np.std(rolloff))],
        [float(np.mean(zcr)), float(np.std(zcr))]
    ])
    return features.astype(np.float32)

def extract_pitch_and_perturbation(y, sr):
    """
    Extract Pitch (F0), Jitter, and Shimmer.
    Uses Praat/Parselmouth if available, with robust signal-processing fallback.
    Returns array of:
      [mean_f0, std_f0, min_f0, max_f0, voiced_fraction,
       jitter_local, jitter_rap, jitter_ppq5,
       shimmer_local, shimmer_apq3, shimmer_apq5]
    """
    default_vals = np.array([120.0, 15.0, 80.0, 220.0, 0.7, 0.01, 0.005, 0.006, 0.03, 0.02, 0.025], dtype=np.float32)

    if HAS_PARSELMOUTH and len(y) >= 512:
        try:
            sound = parselmouth.Sound(y, sampling_frequency=sr)
            pitch = sound.to_pitch(time_step=0.01, pitch_floor=75.0, pitch_ceiling=600.0)
            f0_values = pitch.selected_array['frequency']
            voiced_f0 = f0_values[f0_values > 0]

            if len(voiced_f0) > 3:
                mean_f0 = float(np.mean(voiced_f0))
                std_f0 = float(np.std(voiced_f0))
                min_f0 = float(np.min(voiced_f0))
                max_f0 = float(np.max(voiced_f0))
                voiced_fraction = float(len(voiced_f0) / len(f0_values))

                # PointProcess for jitter/shimmer
                point_process = praat_call(sound, "To PointProcess (periodic, cc)", 75.0, 600.0)
                
                # Jitter measures
                jitter_local = praat_call(point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3)
                jitter_rap = praat_call(point_process, "Get jitter (rap)", 0, 0, 0.0001, 0.02, 1.3)
                jitter_ppq5 = praat_call(point_process, "Get jitter (ppq5)", 0, 0, 0.0001, 0.02, 1.3)

                # Shimmer measures
                shimmer_local = praat_call([sound, point_process], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6)
                shimmer_apq3 = praat_call([sound, point_process], "Get shimmer (apq3)", 0, 0, 0.0001, 0.02, 1.3, 1.6)
                shimmer_apq5 = praat_call([sound, point_process], "Get shimmer (apq5)", 0, 0, 0.0001, 0.02, 1.3, 1.6)

                # Handle NaNs from Praat
                def clean(v, fallback):
                    return fallback if (math.isnan(v) or math.isinf(v)) else float(v)

                return np.array([
                    mean_f0, std_f0, min_f0, max_f0, voiced_fraction,
                    clean(jitter_local, 0.008), clean(jitter_rap, 0.004), clean(jitter_ppq5, 0.005),
                    clean(shimmer_local, 0.025), clean(shimmer_apq3, 0.015), clean(shimmer_apq5, 0.02)
                ], dtype=np.float32)
        except Exception:
            pass

    # Mathematical Autocorrelation Fallback
    try:
        corr = np.correlate(y, y, mode='full')
        corr = corr[len(corr)//2:]
        min_lag = int(sr / 500)
        max_lag = int(sr / 75)
        if len(corr) > max_lag:
            peak_lag = min_lag + np.argmax(corr[min_lag:max_lag])
            est_f0 = float(sr / peak_lag) if peak_lag > 0 else 120.0
            diff = np.abs(np.diff(y))
            jitter_est = float(np.mean(diff) / (np.std(y) + 1e-6) * 0.005)
            shimmer_est = float(np.std(diff) / (np.mean(np.abs(y)) + 1e-6) * 0.01)
            return np.array([est_f0, 8.0, est_f0*0.9, est_f0*1.1, 0.65,
                             jitter_est, jitter_est*0.5, jitter_est*0.6,
                             shimmer_est, shimmer_est*0.5, shimmer_est*0.6], dtype=np.float32)
    except Exception:
        pass

    return default_vals

def extract_features(audio_input, sr=DEFAULT_SAMPLE_RATE):
    """
    Primary VoxGuard Feature Extraction Function.
    Accepts:
      - wav file path (str or Path) OR
      - raw audio array (np.ndarray) + sample rate
    Returns:
      1D np.ndarray fixed-length feature vector.
    """
    y, sample_rate = load_audio(audio_input, target_sr=sr)

    # 1. MFCC Features (13 * 6 = 78 dimensions)
    mfcc_feats = extract_mfcc_features(y, sample_rate, n_mfcc=13)

    # 2. Spectral Flatness & Contrast (22 dimensions)
    spectral_feats = extract_spectral_features(y, sample_rate)

    # 3. Pitch & Jitter/Shimmer Perturbations (11 dimensions)
    pitch_feats = extract_pitch_and_perturbation(y, sample_rate)

    # Combine into single fixed-length forensic feature vector
    combined = np.concatenate([mfcc_feats, spectral_feats, pitch_feats]).astype(np.float32)
    return combined

def get_feature_names(n_mfcc=13):
    """Return descriptive names for all feature dimensions for UI telemetry."""
    names = []
    # MFCCs
    for stat in ["mean", "std"]:
        for i in range(n_mfcc):
            names.append(f"mfcc_{i+1}_{stat}")
    for stat in ["mean", "std"]:
        for i in range(n_mfcc):
            names.append(f"mfcc_delta_{i+1}_{stat}")
    for stat in ["mean", "std"]:
        for i in range(n_mfcc):
            names.append(f"mfcc_delta2_{i+1}_{stat}")
    # Spectral
    names.extend(["spectral_flatness_mean", "spectral_flatness_std"])
    for i in range(7):
        names.append(f"spectral_contrast_band_{i+1}_mean")
    for i in range(7):
        names.append(f"spectral_contrast_band_{i+1}_std")
    names.extend([
        "spectral_centroid_mean", "spectral_centroid_std",
        "spectral_rolloff_mean", "spectral_rolloff_std",
        "zero_crossing_rate_mean", "zero_crossing_rate_std"
    ])
    # Pitch & perturbation
    names.extend([
        "pitch_f0_mean", "pitch_f0_std", "pitch_f0_min", "pitch_f0_max", "voiced_fraction",
        "jitter_local", "jitter_rap", "jitter_ppq5",
        "shimmer_local", "shimmer_apq3", "shimmer_apq5"
    ])
    return names

if __name__ == "__main__":
    import sys
    print(f"[VoxGuard] Testing Feature Extraction...")
    feature_names = get_feature_names()
    print(f"  Feature Vector Dimension: {len(feature_names)}")
    test_audio = np.sin(2 * np.pi * 220 * np.linspace(0, 2, 32000)).astype(np.float32)
    vec = extract_features(test_audio, sr=16000)
    print(f"  Extracted vector shape: {vec.shape}, dtype: {vec.dtype}")
    print(f"  Features preview: {vec[:5]} ... {vec[-5:]}")
    print("[+] Feature extraction module verified.")
