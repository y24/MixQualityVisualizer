param([string]$Repository = 'y24/MixQualityVisualizer')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$build = Get-Content -LiteralPath (Join-Path $projectRoot '.cache/last-windows-build.json') -Raw | ConvertFrom-Json
$info = Get-Content -LiteralPath (Join-Path $build.directory 'build-info.json') -Raw | ConvertFrom-Json
if ($info.runtimeMode -ne 'external-python' -or $info.pythonBundled -or $info.analysisPackagesBundled) { throw 'Python非同梱の最新ビルドを用意してください。' }
$version = $info.analysisVersion
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (!$gh) { $gh = Join-Path $projectRoot '.cache/tools/github-cli/bin/gh.exe' }
if (!(Test-Path -LiteralPath $gh)) { throw 'GitHub CLIを用意して gh auth login を実行してください。' }
$checksums = Get-Content -LiteralPath ([IO.Path]::ChangeExtension($build.applicationArchive, '.json')) -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $build.applicationArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksums.sha256) { throw 'アプリZIPのSHA-256が一致しません。' }
& $gh auth status
if ($LASTEXITCODE -ne 0) { throw 'gh auth login を実行してください。' }
$branches = & $gh api "repos/$Repository/branches" --jq 'length'
if ($LASTEXITCODE -ne 0) { throw 'リポジトリを確認できません。' }
if ($branches -eq '0') {
  $content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("# Mix Atlas`n`nWindows application. Python/uv and analysis dependencies are installed by each user from upstream sources.`n"))
  & $gh api --method PUT "repos/$Repository/contents/README.md" -f 'message=Initialize release repository' -f "content=$content" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '初期コミットを作成できませんでした。' }
}
& $gh release view "v$version" --repo $Repository 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $gh release create "v$version" --repo $Repository --draft --title "Mix Atlas $version" --notes 'Requires Python 3.13 x64 or uv. Analysis packages are downloaded directly from upstream sources during setup. No Python or analysis runtime is bundled.'
  if ($LASTEXITCODE -ne 0) { throw 'Releaseを作成できませんでした。' }
}
$isDraft = & $gh release view "v$version" --repo $Repository --json isDraft --jq '.isDraft'
if ($LASTEXITCODE -ne 0 -or $isDraft -ne 'true') { throw '既存の公開Releaseには追記しません。別のバージョンでビルドしてください。' }
& $gh release upload "v$version" $build.applicationArchive --repo $Repository
if ($LASTEXITCODE -ne 0) { throw 'アプリをアップロードできませんでした。' }
Write-Output "下書きReleaseへアプリZIPのみをアップロードしました: https://github.com/$Repository/releases"
