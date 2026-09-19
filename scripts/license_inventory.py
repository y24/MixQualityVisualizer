"""Inventory packaged metadata; this is not a legal compliance certification."""
from email.parser import Parser
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile


def inventory(archive):
    packages = []
    with zipfile.ZipFile(archive) as source:
        names = set(source.namelist())
        for name in sorted(names):
            if not name.endswith('.dist-info/METADATA'):
                continue
            metadata = Parser().parsestr(source.read(name).decode('utf8'))
            directory = PurePosixPath(name).parent
            declared = []
            for filename in metadata.get_all('License-File', []):
                options = [str(directory / 'licenses' / filename), str(directory / filename)]
                present = next((option for option in options if option in names), None)
                declared.append({'declared':filename, 'path':present})
            packages.append({
                'name':metadata['Name'], 'version':metadata['Version'],
                'metadata':name,
                'license':metadata.get('License-Expression') or metadata.get('License') or metadata.get_all('Classifier', []),
                'license_files':declared,
                'project_urls':metadata.get_all('Project-URL', []),
                'home_page':metadata.get('Home-page'),
            })
        notices = sorted(name for name in names if any(word in PurePosixPath(name).name.lower() for word in ('license', 'licence', 'copying', 'notice')))
    return {'archive':Path(archive).name, 'legal_approval':False, 'scope':'Metadata and notice presence only; native dependencies and source obligations require separate review.', 'packages':packages, 'notice_files':notices}


if __name__ == '__main__':
    result = inventory(sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    missing = [(package['name'], item['declared']) for package in result['packages'] for item in package['license_files'] if not item['path']]
    print(json.dumps({'packages':len(result['packages']), 'notice_files':len(result['notice_files']), 'missing_declared_files':missing}, ensure_ascii=False))
    if missing:
        raise SystemExit(1)
