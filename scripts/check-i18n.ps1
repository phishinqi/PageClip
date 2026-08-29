$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$zhPath = Join-Path $root '_locales/zh_CN/messages.json'
$enPath = Join-Path $root '_locales/en/messages.json'
$zh = Get-Content -LiteralPath $zhPath -Raw | ConvertFrom-Json
$en = Get-Content -LiteralPath $enPath -Raw | ConvertFrom-Json
$zhKeys = @($zh.PSObject.Properties.Name | Sort-Object)
$enKeys = @($en.PSObject.Properties.Name | Sort-Object)
if (($zhKeys -join "`n") -ne ($enKeys -join "`n")) { throw 'zh_CN and en message keys differ' }
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$placeholders = @($manifest.name, $manifest.description, $manifest.action.default_title) + @($manifest.commands.PSObject.Properties | ForEach-Object { $_.Value.description })
foreach ($value in $placeholders) {
  if ($value -match '^__MSG_(.+)__$' -and -not $zh.PSObject.Properties.Name.Contains($Matches[1])) { throw ('Missing manifest message: ' + $Matches[1]) }
}
Write-Output "i18n validation passed: $($zhKeys.Count) keys"
