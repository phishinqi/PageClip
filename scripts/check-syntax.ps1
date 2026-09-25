$ErrorActionPreference = 'Stop'
# Windows PowerShell defaults to ASCII when piping text into native programs.
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$root = Split-Path -Parent $PSScriptRoot
$excluded = '\\(release|node_modules|gui-test-screenshots|Bookmark_Sidebar-master|VertiTab|\.git)\\'
$files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in @('.js', '.mjs') -and $_.FullName -notmatch $excluded } | Sort-Object FullName -Unique
foreach ($file in $files) {
  # Parse explicitly as ES modules; ambiguous .js files can pass node --check unchecked.
  $output = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | & node --input-type=module --check 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("JavaScript syntax check failed: " + $file.FullName + "`n" + ($output -join "`n"))
  }
}
foreach ($locale in @('zh_CN', 'en')) {
  $path = Join-Path $root ("_locales/{0}/messages.json" -f $locale)
  Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
}
Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
Write-Output ("Syntax/JSON validation passed: {0} JavaScript files" -f $files.Count)
