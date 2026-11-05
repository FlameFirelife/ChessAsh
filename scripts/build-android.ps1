param([switch]$Debug)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'build-common.ps1')
    Initialize-ChessAshBuild -Platform Android
    if ($Debug) { & (Join-Path $PSScriptRoot 'android-build.ps1') -SkipWebBuild }
    else { & (Join-Path $PSScriptRoot 'android-release.ps1') -SkipWebBuild }
} catch {
    Write-Host "Android build failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if (Get-Command Exit-ChessAshBuildLock -ErrorAction SilentlyContinue) { Exit-ChessAshBuildLock }
}
