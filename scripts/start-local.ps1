$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeVersion = ([IO.File]::ReadAllText((Join-Path $projectRoot 'aws/node-version.txt'))).Trim()
$runtimeRoot = Join-Path $projectRoot '.runtime'
$nodeExecutable = Join-Path $runtimeRoot "node-v$nodeVersion-win-x64/node.exe"
$workspaceNode = Join-Path $projectRoot ".tools/node-v$nodeVersion-win-x64/node.exe"
if (Test-Path -LiteralPath $workspaceNode) {
    $nodeExecutable = $workspaceNode
}
if (-not (Test-Path -LiteralPath $nodeExecutable)) {
    Write-Host 'Downloading official Node.js runtime into this folder...'
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $archiveName = "node-v$nodeVersion-win-x64.zip"
    $archivePath = Join-Path $runtimeRoot $archiveName
    $checksumsPath = Join-Path $runtimeRoot 'SHASUMS256.txt'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $archivePath
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt" -OutFile $checksumsPath
    $line = Get-Content -LiteralPath $checksumsPath | Where-Object { ($_ -split '\s+')[-1] -eq $archiveName }
    if (-not $line) { throw 'Official checksum entry was not found.' }
    $expectedHash = ($line -split '\s+')[0]
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLower() -ne $expectedHash) { throw 'Checksum mismatch. Runtime was not started.' }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeRoot -Force
}
Write-Host ''
Write-Host 'DICT_PONG local server' -ForegroundColor Cyan
Write-Host 'Open http://127.0.0.1:3000 in your browser.' -ForegroundColor Green
Write-Host 'Keep this window open while playing. Ctrl+C stops the server.'
Write-Host ''
& $nodeExecutable server/index.js
exit $LASTEXITCODE
