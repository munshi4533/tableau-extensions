#!/usr/bin/env python3
"""Creates a new extension from templates/viz-extension and rebuilds the repo.

Usage:  python3 tools/new_extension.py <folder-name> "<Display Name>"
Example: python3 tools/new_extension.py kpi-card "KPI Card"
"""
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

if len(sys.argv) < 3:
    sys.exit(__doc__)
folder, name = sys.argv[1], sys.argv[2]
if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', folder):
    sys.exit('Folder name: lowercase letters, digits and dashes only, e.g. kpi-card')
dest = ROOT / 'extensions' / folder
if dest.exists():
    sys.exit(f'extensions/{folder} already exists')

manifest = ''.join(w.capitalize() for w in folder.split('-'))
shutil.copytree(ROOT / 'templates' / 'viz-extension', dest)
for f in dest.rglob('*'):
    if f.is_file() and f.suffix in {'.html', '.js', '.css', '.json'}:
        f.write_text(f.read_text().replace('__NAME__', name).replace('__MANIFEST__', manifest))
print(f'Created extensions/{folder} ({name})')
subprocess.run([sys.executable, str(ROOT / 'tools' / 'build.py')], check=True)
print(f'\nNext: edit extensions/{folder}/main.js, open http://localhost:8765/extensions/{folder}/dev/preview.html,'
      f'\n      and load manifests/localhost/{manifest}.trex in Tableau Desktop.')
