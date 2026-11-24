
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Regenerate the smaller Community icons from the approved 1024px pictogram.
$source = [Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'icon-1024.png'))
try {
    foreach ($size in 128, 256) {
        $bitmap = [Drawing.Bitmap]::new($size, $size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, 0, 0, $size, $size)
            $bitmap.Save((Join-Path $PSScriptRoot "icon-$size.png"), [Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $source.Dispose()
}
