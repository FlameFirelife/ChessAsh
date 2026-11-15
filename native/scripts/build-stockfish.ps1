param(
    [Parameter(Mandatory)]
    [ValidateSet('Windows', 'arm64-v8a', 'x86_64')]
    [string]$Abi,
    [string]$Ndk,
    [Parameter(Mandatory)]
    [string]$Source,
    [Parameter(Mandatory)]
    [string]$Output,
    [switch]$Optimized
)

$ErrorActionPreference = 'Stop'
$files = @(
    'attacks.cpp', 'benchmark.cpp', 'bitboard.cpp', 'evaluate.cpp', 'main.cpp',
    'misc.cpp', 'movegen.cpp', 'movepick.cpp', 'position.cpp', 'search.cpp',
    'thread.cpp', 'timeman.cpp', 'tt.cpp', 'uci.cpp', 'ucioption.cpp', 'tune.cpp',
    'syzygy/tbprobe.cpp', 'nnue/nnue_accumulator.cpp', 'nnue/nnue_misc.cpp',
    'nnue/network.cpp', 'nnue/features/p_hm.cpp', 'engine.cpp', 'score.cpp', 'memory.cpp'
)
if ($Abi -eq 'Windows') {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $install = & $vswhere -latest -property installationPath
    if (!$install) { throw 'Install Visual Studio with Desktop development with C++ and LLVM.' }
    Import-Module (Join-Path $install 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll')
    Enter-VsDevShell -VsInstallPath $install -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
    $clang = Join-Path $install 'VC/Tools/Llvm/x64/bin/clang-cl.exe'
    $objects = Join-Path (Split-Path -Parent $Source) 'windows-objects'
    New-Item -ItemType Directory -Force -Path $objects | Out-Null
    Push-Location $objects
    try {
        $sources = $files | ForEach-Object { Join-Path $Source $_ }
        $simd = if ($Optimized) { @('/DUSE_AVX2', '/clang:-mavx2') } else { @() }
        & $clang /nologo /O2 /MT /std:c++17 /EHsc /D_USE_MATH_DEFINES /DUSE_LITE_NET /DNDEBUG /clang:-mpopcnt @simd "/Fe:$Output" @sources Advapi32.lib Shell32.lib
        if ($LASTEXITCODE) { throw 'Stockfish Windows build failed.' }
    } finally {
        Pop-Location
    }
} else {
    $clang = Join-Path $Ndk 'toolchains/llvm/prebuilt/windows-x86_64/bin/clang++.exe'
    $target = if ($Abi -eq 'arm64-v8a') { 'aarch64-linux-android24' } else { 'x86_64-linux-android24' }
    $flags = @(
        "--target=$target", '-std=c++17', '-O3', '-DNDEBUG', '-DIS_64BIT',
        '-DUSE_LITE_NET', '-DUSE_PREFETCH', '-DUSE_POPCNT', '-fPIE'
    )
    if ($Abi -eq 'x86_64') { $flags += '-mpopcnt' }
    if ($Abi -eq 'arm64-v8a') {
        $flags += $(if ($Optimized) { '-DUSE_NEON=8' } else { '-DUSE_NEON' })
    }
    if ($Optimized) {
        if ($Abi -eq 'arm64-v8a') {
            $flags += '-march=armv8-a+dotprod', '-DUSE_NEON_DOTPROD'
        } else {
            $flags += '-mavx2', '-DUSE_AVX2', '-DUSE_SSSE3', '-DUSE_SSE41', '-DUSE_SSE2'
        }
    }
    Push-Location $Source
    try {
        & $clang @flags @files -static-libstdc++ -pie '-Wl,-z,max-page-size=16384' -o $Output
        if ($LASTEXITCODE) { throw "Stockfish $Abi build failed." }
    } finally {
        Pop-Location
    }
}
