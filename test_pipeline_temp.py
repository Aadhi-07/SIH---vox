import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.inference import analyze_audio_chunk
from ml.feature_extraction import load_audio, chunk_audio_stream

for name in ['demo_bonafide.wav', 'demo_spoofed.wav']:
    p = Path('data') / name
    if p.exists():
        y, sr = load_audio(p)
        print(f"=== {name} ===")
        for i, (chunk, s, e) in enumerate(chunk_audio_stream(y, sr, 2.0, 0.5)):
            if i < 8:
                res = analyze_audio_chunk(chunk, sr)
                print(f"  Chunk {i} [{s:.1f}s-{e:.1f}s]: Risk={res['risk_score']}%, Alert={res['alert']}, Flatness={res['telemetry'].get('spectral_flatness')}, Jitter={res['telemetry'].get('jitter_local')}, F0={res['telemetry'].get('pitch_f0_mean')}")
