"""Vendor official embedded CPython and the locked packages from the build venv."""
import argparse
import hashlib
import importlib.metadata as metadata
import json
from pathlib import Path
import shutil
import sys
import urllib.request
import zipfile
from packaging.requirements import Requirement

VERSION='3.13.3'
ARCHIVE=f'python-{VERSION}-embed-amd64.zip'
SHA256='59ff76e16e6597de47474fb22be69e7191a89116910d728ab735079b078e52db'
ROOT=Path(__file__).resolve().parents[1]


def bundle(destination):
    if sys.platform!='win32' or sys.version_info[:2]!=(3,13) or sys.maxsize<2**32:
        raise RuntimeError('Build using Windows x64 Python 3.13')
    destination=destination.resolve()
    if not destination.is_relative_to(ROOT/'dist') or destination.exists():
        raise ValueError('Runtime destination must be a new directory inside dist')
    cache=ROOT/'.cache'/'python-embed'
    cache.mkdir(parents=True,exist_ok=True)
    archive=cache/ARCHIVE
    if not archive.exists():
        urllib.request.urlretrieve(f'https://www.python.org/ftp/python/{VERSION}/{ARCHIVE}',archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=SHA256:
        raise ValueError('Embedded Python archive checksum mismatch')
    site=(ROOT/'.venv'/'Lib'/'site-packages').resolve()
    records=[]
    for line in (ROOT/'requirements-lock.txt').read_text(encoding='utf8').splitlines():
        if not line.strip() or line.startswith('#'):continue
        requirement=Requirement(line)
        distribution=metadata.distribution(requirement.name)
        if distribution.version not in requirement.specifier:
            raise ValueError(f'Build dependency does not match lock: {requirement.name}')
        if not distribution.files:raise ValueError(f'No file manifest: {requirement.name}')
        records.append((distribution,requirement))
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            if not (destination/member.filename).resolve().is_relative_to(destination):
                raise ValueError('Invalid embedded archive entry')
        z.extractall(destination)
    # Isolated relative search paths; do not inherit user Python, registry or PATH.
    (destination/'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../app\nimport site\n',encoding='utf8')
    target_site=destination/'Lib'/'site-packages'
    packages=[]
    copied=set()
    for distribution,requirement in records:
        for entry in distribution.files:
            source=Path(distribution.locate_file(entry)).resolve()
            if not source.is_relative_to(site):continue  # Console entry points not used.
            if source.suffix=='.pyc' or '__pycache__' in source.parts:continue
            # The application uses precompiled operators, never C++ extensions.
            legal_notice = any(word in source.name.lower() for word in ('license', 'licence', 'copying', 'notice', 'authors'))
            if not legal_notice and (source.suffix in ('.lib', '.pdb') or 'include' in source.relative_to(site).parts):continue
            if not source.is_file():raise FileNotFoundError(source)
            relative=source.relative_to(site)
            if relative in copied:continue
            target=target_site/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source,target)
            copied.add(relative)
        packages.append({'name':requirement.name,'version':distribution.version})
        print(f'Bundled {requirement.name} {distribution.version}',flush=True)
    manifest={'python':VERSION,'archive':ARCHIVE,'sha256':SHA256,'packages':packages}
    (destination/'runtime-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path)
    bundle(parser.parse_args().destination)
