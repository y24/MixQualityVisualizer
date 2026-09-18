param([switch]$Cuda)
$ErrorActionPreference = 'Stop'
$appDirectory = Join-Path $PSScriptRoot 'resources\app'
Set-Location -LiteralPath $appDirectory
New-Item -ItemType Directory -Force '.cache\tmp' | Out-Null
$env:TEMP = Join-Path $appDirectory '.cache\tmp'
$env:TMP = $env:TEMP
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.13 -m venv .venv
    } else {
        & python -c "import sys; assert sys.version_info[:2] == (3,13), 'Python 3.13 required'"
        if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.13 x64, then run Setup.cmd again.' }
        & python -m venv .venv
    }
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 x64 is required. Install it and run Setup.cmd again.' }
}
& .\.venv\Scripts\python.exe -m pip install --cache-dir .cache\pip -r requirements-lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
if ($Cuda) {
    & .\.venv\Scripts\python.exe -m pip install --cache-dir .cache\pip --upgrade --no-deps -r requirements-cuda.txt
    if ($LASTEXITCODE -ne 0) { throw 'CUDA installation failed.' }
}
& .\.venv\Scripts\python.exe scripts/make_demo.py
if ($LASTEXITCODE -ne 0) { throw 'Demo generation failed.' }
& .\.venv\Scripts\python.exe -c "import torch; print('CUDA available:', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw 'Engine verification failed.' }
Write-Host 'Setup complete. Launch MixAtlas.exe. Keep the entire folder in a writable location.'
