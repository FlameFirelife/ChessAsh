$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$artRoot = Join-Path $projectRoot 'build'
New-Item -ItemType Directory -Path $artRoot -Force | Out-Null
function Draw-ChessAshIcon([int]$size, [string]$destination) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#211f1d'))
    $graphics.ScaleTransform(($size / 256.0), ($size / 256.0))
    $copper = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#d69b72'))
    $cream = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f0e6d8'))
    $points = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(55,49),[System.Drawing.PointF]::new(98,80),[System.Drawing.PointF]::new(158,80),[System.Drawing.PointF]::new(201,49),[System.Drawing.PointF]::new(187,144),[System.Drawing.PointF]::new(128,188),[System.Drawing.PointF]::new(69,144))
    $graphics.FillPolygon($copper, $points)
    $graphics.FillRectangle($cream,93,93,16,29)
    $graphics.FillRectangle($cream,120,93,16,29)
    $graphics.FillRectangle($cream,147,93,16,29)
    $graphics.FillRectangle($cream,93,112,70,14)
    $graphics.FillPolygon($cream,[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(108,123),[System.Drawing.PointF]::new(148,123),[System.Drawing.PointF]::new(156,159),[System.Drawing.PointF]::new(100,159)))
    $graphics.FillRectangle($cream,91,160,74,13)
    $graphics.FillRectangle($copper,72,204,112,9)
    $bitmap.Save($destination,[System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose(); $copper.Dispose(); $cream.Dispose()
}
Draw-ChessAshIcon 256 (Join-Path $artRoot 'icon.png')
$pngBytes = [System.IO.File]::ReadAllBytes((Join-Path $artRoot 'icon.png'))
$iconStream = [System.IO.File]::Create((Join-Path $artRoot 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$pngBytes.Length); $writer.Write([uint32]22); $writer.Write($pngBytes)
$writer.Dispose()
Draw-ChessAshIcon 256 (Join-Path $projectRoot 'native/assets/android/drawable-nodpi/chessash_icon.png')
