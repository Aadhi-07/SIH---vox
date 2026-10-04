import sys
sys.path.insert(0, ".")
import soundfile as sf
from ml.inference import score_audio_chunk, analyze_audio_chunk

y_bona, sr = sf.read('data/demo_bonafide.wav')
y_spoo, sr = sf.read('data/demo_spoofed.wav')

res_bona = analyze_audio_chunk(y_bona[:sr*2], sr)
res_spoo = analyze_audio_chunk(y_spoo[:sr*2], sr)

print('--- VERIFICATION INFERENCE RESULTS ---')
print(f"Genuine Call Chunk (2s): Risk Score = {res_bona['risk_score']}%, Alert = {res_bona['alert']}")
print(f"  Telemetry: {res_bona['telemetry']}")
print(f"Cloned Call Chunk (2s):  Risk Score = {res_spoo['risk_score']}%, Alert = {res_spoo['alert']}")
print(f"  Telemetry: {res_spoo['telemetry']}")
