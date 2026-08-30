$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$excluded = '\\(release|Bookmark_Sidebar-master|VertiTab|\.git)\\'
$files = Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.js' | Where-Object { $_.FullName -notmatch $excluded } | Sort-Object FullName -Unique
foreach ($file in $files) {
  $output = & node --check $file.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("JavaScript syntax check failed: " + $file.FullName + "`n" + ($output -join "`n"))
  }
}
foreach ($locale in @('zh_CN', 'en')) {
  $path = Join-Path $root ("_locales/{0}/messages.json" -f $locale)
  Get-Content -LiteralPath $path -Raw | ConvertFrom-Json | Out-Null
}
Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json | Out-Null
Write-Output ("Syntax/JSON validation passed: {0} JavaScript files" -f $files.Count)
