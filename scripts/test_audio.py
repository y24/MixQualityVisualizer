"""Keep test scratch files in a fresh project-local directory."""
from pathlib import Path
import subprocess
import sys
import uuid
root=Path(__file__).resolve().parents[1]
scratch=root/'.cache'/'tests'/uuid.uuid4().hex
scratch.parent.mkdir(parents=True,exist_ok=True)
raise SystemExit(subprocess.call([sys.executable,'-m','pytest','tests','-q','--basetemp',str(scratch)],cwd=root))
