$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
New-Item -ItemType Directory -Force .cache\tmp | Out-Null
$env:TEMP = Join-Path $PSScriptRoot '.cache\tmp'
$env:TMP = $env:TEMP
$env:ELECTRON_CACHE = Join-Path $PSScriptRoot '.cache\electron'
python -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Python仮想環境の作成に失敗しました。Python 3.13以上を確認してください。' }
& .\.venv\Scripts\python.exe -m pip install --cache-dir .cache\pip -r requirements-lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python依存関係のインストールに失敗しました。' }
npm.cmd ci --cache .cache/npm
if ($LASTEXITCODE -ne 0) { throw 'Electron依存関係のインストールに失敗しました。' }
& .\.venv\Scripts\python.exe scripts/make_demo.py
Write-Host 'Setup complete. Run start.cmd to launch Mix Atlas.'
