param(
    [ValidateSet('Windows', 'Android')]
    [string]$Platform = 'Windows',
    [ValidateSet('arm64-v8a', 'x86_64')]
    [string]$Abi = 'arm64-v8a',
    [string]$Ndk = $env:ANDROID_NDK_HOME
)

$ErrorActionPreference = 'Stop'
$native = Split-Path -Parent $PSScriptRoot
$legacy = Split-Path -Parent $native
$downloads = Join-Path $native 'runtime/engine-downloads'
$output = Join-Path $native 'engines/windows'
$stockfishName = 'stockfish.exe'
if ($Platform -eq 'Android') {
    if (!$Ndk) { throw 'Pass the Android NDK installation path with -Ndk.' }
    $clang = Join-Path $Ndk 'toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe'
    if (!(Test-Path -LiteralPath $clang)) { throw 'Pass the Android NDK installation path with -Ndk.' }
    $output = Join-Path $native "engines/android/$Abi"
    $stockfishName = 'libstockfish.so'
}

function Get-VerifiedDownload([string]$Url, [string]$Destination, [string]$Hash) {
    if ((Test-Path -LiteralPath $Destination) -and (Get-FileHash -LiteralPath $Destination).Hash -eq $Hash) { return }
    curl.exe -fLSs --retry 2 $Url -o "$Destination.part"
    if ($LASTEXITCODE -or (Get-FileHash -LiteralPath "$Destination.part").Hash -ne $Hash) {
        throw "Download failed verification: $Url"
    }
    Move-Item -LiteralPath "$Destination.part" -Destination $Destination -Force
}

New-Item -ItemType Directory -Force -Path $downloads, $output | Out-Null
$archive = Join-Path $downloads 'stockfish-js-19.0.1.tar.gz'
$archiveHash = 'A18AA8A871F5265014B110B3E07804FF3637899D2E189BE6DED2B99E2C17A10E'
Get-VerifiedDownload 'https://codeload.github.com/nmrugg/stockfish.js/tar.gz/refs/tags/v19.0.1' $archive $archiveHash
$release = 'stockfish.js-19.0.1'
$engineSource = Join-Path $downloads "$release/src"
tar -xf $archive -C $downloads "$release/src" "$release/Copying.txt"
if ($LASTEXITCODE) { throw 'Stockfish source extraction failed.' }
$main = Join-Path $engineSource 'main.cpp'
$entry = [IO.File]::ReadAllText($main)
if (!$entry.Contains('    uci.loop();')) { throw 'Stockfish native entry point changed.' }
[IO.File]::WriteAllText($main, $entry.Replace('    uci.loop();', '    uci->loop();'))
$network = 'nn-61e7af4bb97d.nnue'
$networkPath = Join-Path $engineSource $network
Get-VerifiedDownload "https://tests.stockfishchess.org/api/nn/$network" $networkPath '61E7AF4BB97D51EEEB25D322916F86513B5CD3A827CE189C98C6E31946F99E5B'

$buildAbi = if ($Platform -eq 'Windows') { 'Windows' } else { $Abi }
& (Join-Path $PSScriptRoot 'build-stockfish.ps1') -Abi $buildAbi -Ndk $Ndk -Source $engineSource -Output (Join-Path $output $stockfishName)
$optimizedName = if ($Platform -eq 'Windows') { 'stockfish-avx2.exe' } elseif ($Abi -eq 'arm64-v8a') { 'libstockfish_dotprod.so' } else { 'libstockfish_avx2.so' }
& (Join-Path $PSScriptRoot 'build-stockfish.ps1') -Abi $buildAbi -Ndk $Ndk -Source $engineSource -Output (Join-Path $output $optimizedName) -Optimized
Copy-Item -LiteralPath (Join-Path $downloads "$release/Copying.txt") -Destination (Join-Path $output 'STOCKFISH-LICENSE.txt') -Force

$foxash = Join-Path $legacy 'resources/foxash'
Copy-Item -LiteralPath (Join-Path $foxash 'LICENSE.txt') -Destination (Join-Path $output 'FOXASH-LICENSE.txt') -Force
if ($Platform -eq 'Windows') {
    Copy-Item -LiteralPath $networkPath -Destination $output -Force
    Copy-Item -LiteralPath (Join-Path $foxash 'foxash.exe') -Destination (Join-Path $output 'foxash.exe') -Force
} else {
    $foxashSource = Join-Path $downloads 'foxash'
    New-Item -ItemType Directory -Force -Path $foxashSource | Out-Null
    tar -xf (Join-Path $foxash 'foxash_source_code.tar.gz') -C $foxashSource
    if ($LASTEXITCODE) { throw 'Foxash source extraction failed.' }
    $graphics = Join-Path $foxashSource 'src/graphics.rs'
    $graphicsSource = [IO.File]::ReadAllText($graphics)
    $unavailable = '        pub fn wait_for_event(&self) -> Result<WindowEvent, String> {'
    if (!$graphicsSource.Contains($unavailable)) { throw 'Foxash platform stub changed.' }
    $waitForInput = @'
        pub fn wait_for_input(&mut self) -> Result<(Vec<String>, Option<String>), String> {
            Err("Foxash graphics are currently supported on Windows and Linux".to_string())
        }

'@
    [IO.File]::WriteAllText($graphics, $graphicsSource.Replace($unavailable, "$waitForInput`n$unavailable"))
    $arch = if ($Abi -eq 'arm64-v8a') { 'aarch64' } else { 'x86_64' }
    $target = "$arch-linux-android"
    $envPrefix = "CARGO_TARGET_$($arch.ToUpper())_LINUX_ANDROID_"
    $linker = "${envPrefix}LINKER"
    $flags = "${envPrefix}RUSTFLAGS"
    $priorLinker = [Environment]::GetEnvironmentVariable($linker)
    $priorFlags = [Environment]::GetEnvironmentVariable($flags)
    try {
        [Environment]::SetEnvironmentVariable($linker, $clang)
        [Environment]::SetEnvironmentVariable($flags, "-C link-arg=--target=${target}24 -C link-arg=-Wl,-z,max-page-size=16384")
        cargo build --manifest-path (Join-Path $foxashSource 'Cargo.toml') --target $target --release --locked
        if ($LASTEXITCODE) { throw 'Foxash Android build failed.' }
        Copy-Item -LiteralPath (Join-Path $foxashSource "target/$target/release/foxash") -Destination (Join-Path $output 'libfoxash.so') -Force
    } finally {
        [Environment]::SetEnvironmentVariable($linker, $priorLinker)
        [Environment]::SetEnvironmentVariable($flags, $priorFlags)
    }
}
Write-Output $output
