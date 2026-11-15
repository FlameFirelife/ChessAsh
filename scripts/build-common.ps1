$ErrorActionPreference = 'Stop'
$script:ChessAshProjectRoot = Split-Path $PSScriptRoot -Parent
if (-not (Get-Variable ChessAshBuildLockHeld -Scope Script -ErrorAction SilentlyContinue)) { $script:ChessAshBuildLockHeld = $false }

function Enter-ChessAshBuildLock {
    if ($script:ChessAshBuildLockHeld) { return }
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $name = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:ChessAshProjectRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 20) }
    finally { $hash.Dispose() }
    $script:ChessAshBuildMutex = New-Object System.Threading.Mutex($false, "Local\ChessAshBuild-$name")
    Write-Host 'Waiting for the project build lock...'
    try { $held = $script:ChessAshBuildMutex.WaitOne([TimeSpan]::FromMinutes(10)) }
    catch [System.Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'Another ChessAsh build is still running. Wait for it to finish and try again.' }
    $script:ChessAshBuildLockHeld = $true
}

function Exit-ChessAshBuildLock {
    if ($script:ChessAshBuildLockHeld) {
        $script:ChessAshBuildMutex.ReleaseMutex()
        $script:ChessAshBuildMutex.Dispose()
        $script:ChessAshBuildLockHeld = $false
    }
}
