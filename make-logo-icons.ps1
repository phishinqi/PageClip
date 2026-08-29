$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$master = 512
$bmp = New-Object System.Drawing.Bitmap $master, $master
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$purple = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,79,70,229))
$points = @(
  (New-Object System.Drawing.Point 160,64),
  (New-Object System.Drawing.Point 352,64),
  (New-Object System.Drawing.Point 400,112),
  (New-Object System.Drawing.Point 400,448),
  (New-Object System.Drawing.Point 256,376),
  (New-Object System.Drawing.Point 112,448),
  (New-Object System.Drawing.Point 112,112)
)
$g.FillPolygon($purple, $points)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, 24)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawLine($pen, 224,160,224,280)
$g.DrawArc($pen, 224,248,64,64,0,180)
$g.DrawLine($pen, 288,280,288,192)
$g.DrawArc($pen, 256,176,32,32,180,180)
$g.DrawLine($pen, 256,192,256,264)
$g.Dispose(); $purple.Dispose(); $pen.Dispose()
foreach ($size in 16,32,48,128) {
  $small = New-Object System.Drawing.Bitmap $size,$size
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.DrawImage($bmp,0,0,$size,$size)
  $sg.Dispose()
  $small.Save((Join-Path $dir "icon$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  $small.Dispose()
}
$bmp.Dispose()
Write-Output 'PageClip logo icons generated'
