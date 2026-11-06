param([switch]$SkipWebBuild, [switch]$RequireSigned)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'build-common.ps1')

function Find-InnoCompiler {
    if ($env:INNO_COMPILER) {
        if (-not (Test-Path -LiteralPath $env:INNO_COMPILER -PathType Leaf)) { throw 'INNO_COMPILER must point to ISCC.exe.' }
        return (Resolve-Path -LiteralPath $env:INNO_COMPILER).Path
    }
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    )
    foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1')) {
        $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        if ($entry -and $entry.PSObject.Properties['InstallLocation'] -and $entry.InstallLocation) { $candidates += Join-Path $entry.InstallLocation 'ISCC.exe' }
    }
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    throw 'Inno Setup 6 was not found. Install it from https://jrsoftware.org/isdl.php or set INNO_COMPILER to ISCC.exe.'
}

$signingScript = Join-Path $PSScriptRoot 'sign-windows.ps1'
$signingEnabled = -not [string]::IsNullOrWhiteSpace($env:CHESSASH_SIGNING_THUMBPRINT)
if ($RequireSigned -or $signingEnabled) { & $signingScript -CheckOnly }
else { Write-Warning 'No Windows signing identity configured. This build will be unsigned. Use -RequireSigned for a public signed build; see SIGNING.md.' }
$compiler = Find-InnoCompiler
try {
    Initialize-ChessAshBuild -Platform Windows -SkipWebBuild:$SkipWebBuild
    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $settings = Get-Content -LiteralPath 'build/release.json' -Raw | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw 'Inno builds require a numeric major.minor.patch[.build] package version.' }
    $docsPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work\release-docs'))
    $workRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work')) + [IO.Path]::DirectorySeparatorChar
    if (-not $docsPath.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid documentation staging path.' }
    New-Item -ItemType Directory -Path $docsPath -Force | Out-Null
    Get-ChildItem -LiteralPath $docsPath -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    $seen = @{}
    foreach ($name in $settings.docs) {
        $document = [IO.Path]::GetFullPath((Join-Path $projectRoot $name))
        if (-not $document.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Release documentation must be inside the project: $name" }
        if (-not (Test-Path -LiteralPath $document -PathType Leaf)) { throw "Release documentation is missing: $name" }
        $leaf = Split-Path $name -Leaf
        if ($seen.ContainsKey($leaf)) { throw "Release documentation has duplicate filenames: $leaf" }
        $seen[$leaf] = $true
        Copy-Item -LiteralPath $document -Destination (Join-Path $docsPath $leaf) -Force
    }
    Write-Host 'Preparing the Windows application...'
    & npx.cmd --no-install electron-builder --win --x64 --dir
    if ($LASTEXITCODE) { throw "Windows application build failed ($LASTEXITCODE)." }
    if (-not (Test-Path -LiteralPath 'release\win-unpacked\ChessAsh.exe')) { throw 'The application executable was not produced.' }
    if ($signingEnabled) { & $signingScript -Path (Join-Path $projectRoot 'release\win-unpacked\ChessAsh.exe') }
    Write-Host 'Compiling the Inno Setup installer...'
    $arguments = @('/Qp', "/DProjectRoot=$projectRoot", "/DAppVersion=$version", "/DAppPublisher=$($settings.publisher)", "/DAppURL=$($settings.publisherURL)", (Join-Path $projectRoot 'installer\ChessAsh.iss'))
    if ($signingEnabled) {
        $escapedSigningScript = $signingScript.Replace('$', '$$')
        $signCommand = 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $q' + $escapedSigningScript + '$q -Path $f'
        $arguments = @('/DSignWindows', "/SChessAsh=$signCommand") + $arguments
    }
    & $compiler @arguments
    if ($LASTEXITCODE) { throw "Inno Setup compilation failed ($LASTEXITCODE)." }
    $output = Join-Path $projectRoot "release\ChessAsh-Setup-$version.exe"
    if (-not (Test-Path -LiteralPath $output)) { throw 'The installer output is missing.' }
    if ($signingEnabled) { & $signingScript -Path $output -VerifyOnly }
    Write-Host "Installer ready: $output"
} finally {
    Exit-ChessAshBuildLock
}
