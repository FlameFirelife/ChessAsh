param([switch]$RequireSigned, [switch]$InstallerTest)
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
    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $settings = Get-Content -LiteralPath 'build/release.json' -Raw | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw 'Inno builds require a numeric major.minor.patch[.build] package version.' }
    Enter-ChessAshBuildLock
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
    $arguments = @('/Qp', "/DProjectRoot=$projectRoot", "/DAppVersion=$version", "/DAppPublisher=$($settings.publisher)", "/DAppURL=$($settings.publisherURL)", (Join-Path $projectRoot 'installer\ChessAsh.iss'))
    $source = Join-Path $projectRoot 'work/native-windows'
    $engines = Join-Path $projectRoot 'native/engines/windows'
    foreach ($name in @('stockfish.exe', 'foxash.exe')) {
        if (!(Test-Path -LiteralPath (Join-Path $engines $name))) {
            throw 'Provision the Windows engines with native/scripts/prepare-engines.ps1 first.'
        }
    }
    & cargo build --release --manifest-path native/Cargo.toml --target-dir native/target --bin chessash-native
    if ($LASTEXITCODE) { throw "Windows application build failed ($LASTEXITCODE)." }
    New-Item -ItemType Directory -Force -Path $source, (Join-Path $source 'engines') | Out-Null
    $exe = Join-Path $source 'ChessAsh.exe'
    Copy-Item -LiteralPath 'native/target/release/chessash-native.exe' -Destination $exe -Force
    Copy-Item -LiteralPath 'build/icon.ico' -Destination (Join-Path $source 'ChessAsh.ico') -Force
    Get-ChildItem -LiteralPath $engines -File | Where-Object {
        $_.Name -in @('stockfish.exe', 'stockfish-avx2.exe', 'foxash.exe',
            'STOCKFISH-LICENSE.txt', 'FOXASH-LICENSE.txt', 'nn-61e7af4bb97d.nnue')
    } | Copy-Item -Destination (Join-Path $source 'engines') -Force

    $transferSource = Join-Path $projectRoot 'work/native-windows-transfer'
    $transferHelper = Join-Path $projectRoot 'work/chessash-transfer.asar'
    New-Item -ItemType Directory -Force -Path $transferSource | Out-Null
    Copy-Item -LiteralPath 'native/migration/export-windows.cjs','native/migration/legacy-origin.html','native/migration/web' -Recurse -Destination $transferSource -Force
    [IO.File]::WriteAllText((Join-Path $transferSource 'package.json'), '{"name":"chessash-library-transfer","main":"export-windows.cjs","version":"1.0.0"}')
    if (!(Test-Path -LiteralPath 'node_modules/@electron/asar/package.json')) {
        throw 'Run npm ci to install the Windows library transfer packager.'
    }
    & node -e "require('@electron/asar').createPackage(process.argv[1], process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; })" $transferSource $transferHelper
    if ($LASTEXITCODE) { throw 'The Windows library transfer helper could not be packaged.' }
    $arguments = @('/DNativeBuild', "/DAppSourceDir=$source", "/DWindowsTransferHelper=$transferHelper") + $arguments
    if (!(Test-Path -LiteralPath $exe)) { throw 'The application executable was not produced.' }
    if ($signingEnabled) { & $signingScript -Path $exe }
    $output = Join-Path $projectRoot "release\ChessAsh-Setup-$version.exe"
    if ($InstallerTest) {
        $testOutput = Join-Path $projectRoot 'work/installer-tests'
        New-Item -ItemType Directory -Force -Path $testOutput | Out-Null
        $arguments = @('/DTestBuild', "/DInstallerOutputDir=$testOutput") + $arguments
        $output = Join-Path $testOutput "ChessAsh-Installer-Test-$version.exe"
    }
    Write-Host 'Compiling the Inno Setup installer...'
    if ($signingEnabled) {
        $escapedSigningScript = $signingScript.Replace('$', '$$')
        $signCommand = 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $q' + $escapedSigningScript + '$q -Path $f'
        $arguments = @('/DSignWindows', "/SChessAsh=$signCommand") + $arguments
    }
    & $compiler @arguments
    if ($LASTEXITCODE) { throw "Inno Setup compilation failed ($LASTEXITCODE)." }
    if (-not (Test-Path -LiteralPath $output)) { throw 'The installer output is missing.' }
    if ($signingEnabled) { & $signingScript -Path $output -VerifyOnly }
    Write-Host "Installer ready: $output"
} finally {
    Exit-ChessAshBuildLock
}
