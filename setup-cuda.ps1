$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    throw '先に setup.ps1 を実行してください。'
}
New-Item -ItemType Directory -Force .cache\tmp | Out-Null
$env:TEMP = Join-Path $PSScriptRoot '.cache\tmp'
$env:TMP = $env:TEMP
Write-Host 'Installing CUDA PyTorch in the project environment (approximately 3.5 GB download).'
& .\.venv\Scripts\python.exe -m pip install --cache-dir .cache\pip --upgrade --no-deps -r requirements-cuda.txt
if ($LASTEXITCODE -ne 0) { throw 'CUDA版PyTorchのインストールに失敗しました。' }
& .\.venv\Scripts\python.exe -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.version.cuda); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'Unavailable'); raise SystemExit(0 if torch.cuda.is_available() else 1)"
if ($LASTEXITCODE -ne 0) { throw 'CUDAを利用できません。NVIDIA GPUとドライバーを確認してください。CPUは引き続き選択できます。' }
Write-Host 'CUDA ready. Restart Mix Atlas and select Auto or GPU in the import dialog.'
