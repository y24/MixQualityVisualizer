"""Explicit network-enabled model smoke test: python -m scripts.smoke_separation."""
from pathlib import Path
import time
import soundfile as sf
from backend.worker import run

root=Path(__file__).resolve().parents[1]
directory=root/'.data'/'smoke'
directory.mkdir(parents=True,exist_ok=True)
x,sr=sf.read(root/'demo-audio'/'mix.wav',dtype='float32')
sf.write(directory/'separation-smoke.wav',x[:sr*2],sr,subtype='FLOAT')
started=time.perf_counter()
result=run({'path':str(directory/'separation-smoke.wav'),'mode':'separate','model':'htdemucs_ft'})
assert set(result['parts'])=={'vocals','drums','bass','other'}
assert all(Path(p).exists() for p in result['media_paths'].values())
print(f"FT separation + analysis + preview passed in {time.perf_counter()-started:.1f}s; id={result['id']}")
