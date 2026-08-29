# 生成扩展图标：512px 母版绘制后高质量缩至 16/32/48/128
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconsDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

$size = 512
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# 圆角矩形底
$rect = New-Object System.Drawing.Rectangle 16, 16, 480, 480
$r = 104
$d = $r * 2
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$c1 = [System.Drawing.Color]::FromArgb(255, 66, 133, 244)
$c2 = [System.Drawing.Color]::FromArgb(255, 23, 78, 166)
$brushArgs = @($rect, $c1, $c2, [single]55)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $brushArgs
$g.FillPath($brush, $path)

# 白色书签缎带（底部带缺口）
$rw = 168
$rx = [int](($size - $rw) / 2)
$ry = 122
$rh = 268
$notch = 66
$pts = @(
  (New-Object System.Drawing.Point $rx, $ry),
  (New-Object System.Drawing.Point ($rx + $rw), $ry),
  (New-Object System.Drawing.Point ($rx + $rw), ($ry + $rh)),
  (New-Object System.Drawing.Point ($rx + [int]($rw / 2)), ($ry + $rh - $notch)),
  (New-Object System.Drawing.Point $rx, ($ry + $rh))
)
$g.FillPolygon([System.Drawing.Brushes]::White, $pts)
$g.Dispose()

foreach ($s in 16, 32, 48, 128) {
  $small = New-Object System.Drawing.Bitmap $s, $s
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $sg.DrawImage($bmp, 0, 0, $s, $s)
  $sg.Dispose()
  $small.Save((Join-Path $iconsDir "icon$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $small.Dispose()
  Write-Output "icon$s.png ok"
}
$bmp.Dispose()
Write-Output 'done'
