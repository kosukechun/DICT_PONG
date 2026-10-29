$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot 'release'
$distributionRoot = Join-Path $projectRoot '配布用'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $distributionRoot | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
function Write-PackageZip([string]$Destination, [string[]]$Paths) {
    $zipStream = [IO.File]::Open($Destination, [IO.FileMode]::Create)
    $zip = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relative in $Paths) {
            $source = Join-Path $projectRoot $relative
            if (-not (Test-Path -LiteralPath $source)) { throw "Missing package file: $relative" }
            if (Test-Path -LiteralPath $source -PathType Container) {
                $files = Get-ChildItem -LiteralPath $source -File -Recurse
            } else { $files = @(Get-Item -LiteralPath $source) }
            foreach ($file in $files) {
                $entryName = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        }
    } finally { $zip.Dispose(); $zipStream.Dispose() }
}
$appPaths = @('public', 'server', 'aws', 'tests', 'scripts', 'start-local.cmd', 'package.json', 'package-lock.json', 'node_modules/ws', 'README.md', 'docs', 'LICENSE', '.env.example')
Write-PackageZip -Destination (Join-Path $releaseRoot 'pong-app.zip') -Paths $appPaths
Copy-Item -LiteralPath (Join-Path $projectRoot 'aws/pong-stack.yaml') -Destination (Join-Path $releaseRoot 'pong-stack.yaml') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/AWS_SETUP.html') -Destination (Join-Path $releaseRoot 'AWS_SETUP.html') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/AWS_SETUP.md') -Destination (Join-Path $releaseRoot 'AWS_SETUP.md') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/architecture.svg') -Destination (Join-Path $releaseRoot 'ARCHITECTURE.svg') -Force
$bundleStream = [IO.File]::Open((Join-Path $releaseRoot 'PONG-AWS-kit.zip'), [IO.FileMode]::Create)
$bundleZip = New-Object IO.Compression.ZipArchive($bundleStream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($name in @('pong-app.zip','pong-stack.yaml','AWS_SETUP.html','AWS_SETUP.md','ARCHITECTURE.svg')) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($bundleZip, (Join-Path $releaseRoot $name), $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $bundleZip.Dispose(); $bundleStream.Dispose() }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $releaseRoot 'pong-app.zip'), (Join-Path $releaseRoot 'pong-stack.yaml') | ForEach-Object { "$($_.Hash.ToLower())  $([IO.Path]::GetFileName($_.Path))" } | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ASCII
foreach ($name in @('PONG-AWS-kit.zip', 'AWS_SETUP.html')) {
    Copy-Item -LiteralPath (Join-Path $releaseRoot $name) -Destination (Join-Path $distributionRoot $name) -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/DISTRIBUTION_README.txt') -Destination (Join-Path $distributionRoot 'はじめに.txt') -Force
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $distributionRoot 'PONG-AWS-kit.zip') | ForEach-Object { "$($_.Hash.ToLower())  PONG-AWS-kit.zip" } | Set-Content -LiteralPath (Join-Path $distributionRoot 'SHA256SUMS.txt') -Encoding ASCII
Get-ChildItem -LiteralPath $releaseRoot -File | Select-Object Name,Length
Write-Output "Distribution: $distributionRoot"
