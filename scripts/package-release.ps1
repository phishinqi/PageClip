param(
  [string]$ChromePath,
  [switch]$ZipOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$privateKey = Join-Path $root 'v1.pem'
$keyTool = Join-Path $PSScriptRoot 'manifest-key.mjs'

$hasPrivateKey = Test-Path -LiteralPath $privateKey -PathType Leaf
if (-not $hasPrivateKey -and -not $ZipOnly) {
  throw "Signing key PEM not found: $privateKey. Use -ZipOnly to create the Chrome Web Store ZIP without a CRX."
}

# Keep the unpacked development manifest pinned to the same public key used for CRX signing when the PEM is available.
if ($hasPrivateKey) {
  & node $keyTool set $manifestPath $privateKey
  if ($LASTEXITCODE -ne 0) { throw 'Failed to fix/verify the development manifest key' }
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-syntax.ps1')
& node (Join-Path $PSScriptRoot 'test-oauth.mjs')
& node (Join-Path $PSScriptRoot 'test-cloud-backup.mjs')
& node (Join-Path $PSScriptRoot 'test-cloud-status.mjs')
& node (Join-Path $PSScriptRoot 'test-auto-backup.mjs')
& node (Join-Path $PSScriptRoot 'test-auto-sync.mjs')
& node (Join-Path $PSScriptRoot 'test-recovery-binary.mjs')
& node (Join-Path $PSScriptRoot 'test-collection-model.mjs')
& node (Join-Path $PSScriptRoot 'test-bookmark-pagination.mjs')
& node (Join-Path $PSScriptRoot 'test-bookmark-import.mjs')
& node (Join-Path $PSScriptRoot 'test-store-lock.mjs')
& node (Join-Path $PSScriptRoot 'test-bookmark-auto-import.mjs')

$sourceManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$sourceManifest.version
if ([string]::IsNullOrWhiteSpace($version)) { throw 'Manifest version is missing' }
if ($sourceManifest.oauth2.client_id -ne '996608683771-c42ubb7c4rchv2du801tf7grp3abj8qo.apps.googleusercontent.com') { throw 'Unexpected OAuth client ID' }

$releaseDir = Join-Path $root 'release'
$packageName = "PageClip-v$version"
$stage = Join-Path $releaseDir $packageName
$zip = Join-Path $releaseDir "$packageName.zip"
$crx = Join-Path $releaseDir "$packageName.crx"

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
if (Test-Path -LiteralPath $crx) { Remove-Item -LiteralPath $crx -Force }
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

# The public Web Store/production package must not carry the development-only manifest key.
& node $keyTool strip (Join-Path $stage 'manifest.json')
if ($LASTEXITCODE -ne 0) { throw 'Failed to strip manifest key from release stage' }

$releaseManifest = Get-Content -LiteralPath (Join-Path $stage 'manifest.json') -Raw | ConvertFrom-Json
if ($null -ne $releaseManifest.key) { throw 'Release manifest still contains key' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'js/cloud-backup.js'))) { throw 'cloud-backup.js missing' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'js/crypto-backup.js'))) { throw 'crypto-backup.js missing' }

$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -File | Select-String -Pattern 'mock-google-token|GOCSPX-|client_secret|clientSecret|BEGIN (RSA|OPENSSH) PRIVATE KEY|accessToken\s*=' -AllMatches
if ($forbidden) { throw 'Release package contains test credentials or private key material' }

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force

if ($ZipOnly) {
  Write-Output "Created $zip"
  Write-Output 'Skipped CRX signing because -ZipOnly was requested.'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ChromePath)) {
  $chromeCandidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Google\Chrome\Application\chrome.exe'),
    (Get-Command chrome.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    (Get-Command google-chrome.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
  )
  foreach ($candidate in $chromeCandidates) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      $ChromePath = [string]$candidate
      break
    }
  }
}
if ([string]::IsNullOrWhiteSpace($ChromePath) -or -not (Test-Path -LiteralPath $ChromePath -PathType Leaf)) {
  throw 'Chrome executable not found. Pass -ChromePath C:\path\to\chrome.exe.'
}

# Chrome signs the staged, key-less directory with the matching private key; the resulting CRX keeps the dev ID.
& $ChromePath "--pack-extension=$stage" "--pack-extension-key=$privateKey"
if ($LASTEXITCODE -ne 0) { throw "Chrome CRX packaging failed with exit code $LASTEXITCODE" }
$generatedCrx = "$stage.crx"
for ($attempt = 0; $attempt -lt 60 -and -not (Test-Path -LiteralPath $generatedCrx -PathType Leaf); $attempt++) {
  Start-Sleep -Milliseconds 500
}
if (-not (Test-Path -LiteralPath $generatedCrx -PathType Leaf)) {
  throw "Chrome did not create expected CRX: $generatedCrx"
}
if ($generatedCrx -ne $crx) { Move-Item -LiteralPath $generatedCrx -Destination $crx -Force }

Write-Output "Created $zip"
Write-Output "Created $crx"
Write-Output "Development manifest key is fixed from $privateKey"
