"""Archive an application distribution, excluding local test/user data."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

runtime, archive = map(Path, sys.argv[1:])
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as target:
    for source in sorted(runtime.rglob('*')):
        if source.is_file() and not {'__pycache__', '.cache', '.data'}.intersection(source.relative_to(runtime).parts):
            target.write(source, source.relative_to(runtime).as_posix())
with archive.open('rb') as source:
    digest = hashlib.file_digest(source, 'sha256').hexdigest()
archive.with_suffix('.json').write_text(json.dumps({'sha256':digest, 'bytes':archive.stat().st_size}), encoding='utf8')
