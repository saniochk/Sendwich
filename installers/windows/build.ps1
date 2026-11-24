
param(
    [Parameter(Mandatory)][string]$Compiler,
    [Parameter(Mandatory)][string]$ZxpSigner,
    [ValidatePattern('^\d+\.\d+(\.\d+)?$')][string]$Version = '0.34.4',
    [switch]$SmokeTest
)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot)
$ZxpSigner=(Resolve-Path -LiteralPath $ZxpSigner).Path
$Compiler=(Resolve-Path -LiteralPath $Compiler).Path
$work=Join-Path $env:TEMP ('sendwich-cep-sign-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$certificate=Join-Path $work 'cep-signing.p12'
$password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Push-Location -LiteralPath $work
try {
    & $ZxpSigner -selfSignedCert ZZ Sendwich Sendwich 'Sendwich CEP' $password $certificate -validityDays 365
    if ($LASTEXITCODE) { throw 'CEP certificate generation failed' }
    foreach($name in 'SendwichAE','SendwichAI') {
        $source=Join-Path $root $name
        $links=Get-ChildItem -LiteralPath $source -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
        if ($links) { throw "$name contains a symbolic link or junction" }
        $zxp=Join-Path $work "$name.zxp"
        & $ZxpSigner -sign $source $zxp $certificate $password -tsa http://timestamp.digicert.com
        if ($LASTEXITCODE) { throw "Could not sign $name" }
        $payload=Join-Path $work $name
        New-Item -ItemType Directory -Path $payload | Out-Null
        tar -xf $zxp -C $payload
        if ($LASTEXITCODE) { throw "Could not extract signed $name" }
        & $ZxpSigner -verify $payload
        if ($LASTEXITCODE) { throw "$name does not verify after extraction" }
    }
    & $Compiler "/DAppVersion=$Version" "/DSignedPanelsDir=$work" (Join-Path $PSScriptRoot 'Sendwich.iss')
    if ($LASTEXITCODE) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $certificate -PathType Leaf) { [IO.File]::Delete($certificate) }
    $password=$null
}
if (!$SmokeTest) { return }

# This mode is for a disposable CI account.
$exe=Join-Path $root "dist/Sendwich-$Version-Windows.exe"
$extensions=Join-Path $env:APPDATA 'Adobe/CEP/extensions'
$documents=[Environment]::GetFolderPath('MyDocuments')
$testOld=Join-Path $extensions 'Sendwich-previous-test'
New-Item -ItemType Directory -Path (Join-Path $testOld 'CSXS'),(Join-Path $testOld 'jsx') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $testOld 'CSXS/manifest.xml') -Value '<ExtensionManifest/>'
Set-Content -LiteralPath (Join-Path $testOld 'jsx/host.jsx') -Value 'function vb_begin() {} function vb_step() {}'
$setupLog=Join-Path $work 'setup.log'
$setupArgs=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/TASKS=figma',('/LOG="' + $setupLog + '"'))
$process=Start-Process $exe -ArgumentList $setupArgs -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $setupLog) { Get-Content -LiteralPath $setupLog -Tail 65 | Out-Host }
    throw "Installer exit code: $($process.ExitCode)"
}
foreach($name in 'SendwichAE','SendwichAI') {
    & $ZxpSigner -verify (Join-Path $extensions $name)
    if ($LASTEXITCODE) { throw "Installed $name signature could not be verified" }
}
if (!(Test-Path -LiteralPath (Join-Path $documents 'Sendwich/Figma/manifest.json'))) { throw 'Missing Figma manifest' }
if (Test-Path -LiteralPath $testOld) { throw 'Earlier panel was not moved out of the CEP directory' }
$backup=Join-Path $env:APPDATA 'Sendwich/Previous Panels'
if (!(Get-ChildItem -LiteralPath $backup -Recurse -Filter 'host.jsx' | Where-Object FullName -match 'Sendwich-previous-test')) {
    throw 'Earlier panel backup not found'
}
$adobe=Get-ChildItem -LiteralPath 'HKCU:\Software\Adobe' -ErrorAction SilentlyContinue
if ($adobe | Where-Object { $_.PSChildName -match '^CSXS\.\d+$' -and $_.GetValueNames() -contains 'PlayerDebugMode' }) {
    throw 'The installer wrote a CEP debug setting'
}
$uninstaller=Join-Path $env:LOCALAPPDATA 'Sendwich/Setup/unins000.exe'
$process=Start-Process $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Uninstaller exit code: $($process.ExitCode)" }
foreach($name in 'SendwichAE','SendwichAI') {
    if (Test-Path -LiteralPath (Join-Path $extensions "$name/CSXS/manifest.xml")) { throw "$name remains after uninstall" }
}
