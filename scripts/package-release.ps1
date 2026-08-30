$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-syntax.ps1')
& node (Join-Path $PSScriptRoot 'test-oauth.mjs')
& node (Join-Path $PSScriptRoot 'test-cloud-backup.mjs')
& node (Join-Path $PSScriptRoot 'test-cloud-status.mjs')
& node (Join-Path $PSScriptRoot 'test-auto-backup.mjs')
& node (Join-Path $PSScriptRoot 'test-recovery-binary.mjs')
& node (Join-Path $PSScriptRoot 'test-collection-model.mjs')
$releaseDir = Join-Path $root 'release'
$stage = Join-Path $releaseDir 'PageClip-v1.6.5'
$zip = Join-Path $releaseDir 'PageClip-v1.6.5.zip'

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$files = @('manifest.json', 'background.js', 'logo.svg', 'options.html', 'options.js', 'sidepanel.html', 'sidepanel.js')
$directories = @('content', 'css', 'js', 'icons', '_locales')
foreach ($relative in $files) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relative" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $relative) -Force
}
foreach ($relative in $directories) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Missing release directory: $relative" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $relative) -Recurse -Force
}

$manifest = Get-Content -LiteralPath (Join-Path $stage 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne '1.6.5') { throw "Unexpected manifest version: $($manifest.version)" }
if ($manifest.oauth2.client_id -ne '996608683771-ab2q6ld3qnh85ckd31fcrgeifbid9pp1.apps.googleusercontent.com') { throw 'Unexpected OAuth client ID' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'js/cloud-backup.js'))) { throw 'cloud-backup.js missing' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'js/crypto-backup.js'))) { throw 'crypto-backup.js missing' }

$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -File | Select-String -Pattern 'mock-google-token|GOCSPX-|client_secret|clientSecret|BEGIN (RSA|OPENSSH) PRIVATE KEY|accessToken\s*=' -AllMatches
if ($forbidden) { throw 'Release package contains test credentials or private key material' }

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Write-Output "Created $zip"
