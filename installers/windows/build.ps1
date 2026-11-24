param(
    [Parameter(Mandatory)][string]$Compiler,
    [ValidatePattern('^\d+\.\d+(\.\d+)?$')][string]$Version = '0.34.1',
    [switch]$SmokeTest
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
& $Compiler "/DAppVersion=$Version" (Join-Path $PSScriptRoot 'Sendwich.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
if (!$SmokeTest) { return }

# Use only on a disposable CI runner. This installs and uninstalls the panels.
$exe = Join-Path $root "dist/Sendwich-$Version-Windows.exe"
$process = Start-Process $exe -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS=figma,cepdebug' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer exit code $($process.ExitCode)" }
$extensions = Join-Path $env:APPDATA 'Adobe/CEP/extensions'
$documents = [Environment]::GetFolderPath('MyDocuments')
foreach ($manifest in @(
    (Join-Path $extensions 'VectorBridgeAE/CSXS/manifest.xml'),
    (Join-Path $extensions 'VectorBridgeAI/CSXS/manifest.xml'),
    (Join-Path $documents 'Sendwich Figma/manifest.json')
)) {
    if (!(Test-Path $manifest)) { throw "Missing installed manifest: $manifest" }
}
$uninstaller = Join-Path $env:LOCALAPPDATA 'Sendwich/unins000.exe'
$process = Start-Process $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Uninstaller exit code $($process.ExitCode)" }
if (Test-Path (Join-Path $extensions 'VectorBridgeAE/CSXS/manifest.xml')) {
    throw 'After Effects panel was not removed'
}
