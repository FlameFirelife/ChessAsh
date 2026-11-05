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

function Invoke-ChessAshCommand {
    param([Parameter(Mandatory=$true)][string]$Command, [string[]]$Arguments = @())
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Command" }
}

function Get-ChessAshReleaseSettings {
    $settings = Get-Content -Raw -LiteralPath (Join-Path $script:ChessAshProjectRoot 'build/release.json') | ConvertFrom-Json
    foreach ($doc in $settings.docs) {
        $path = [IO.Path]::GetFullPath((Join-Path $script:ChessAshProjectRoot $doc))
        if (-not $path.StartsWith($script:ChessAshProjectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Documentation must stay inside the project: $doc" }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing release document: $doc" }
    }
    return $settings
}

function Get-ChessAshFileSha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead([IO.Path]::GetFullPath($Path))
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Initialize-ChessAshBuild {
    param([ValidateSet('Windows','Android')][string]$Platform = 'Windows', [switch]$SkipWebBuild)
    Enter-ChessAshBuildLock
    Set-Location -LiteralPath $script:ChessAshProjectRoot
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $nodeCommand -or -not $npmCommand) { throw 'Install Node.js 22 or newer, reopen the terminal and run this build again.' }
    $node = $nodeCommand.Source
    $npm = $npmCommand.Source
    $version = & $node --version
    if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'ChessAsh builds require Node.js 22 or newer.' }
    $settings = Get-ChessAshReleaseSettings
    $lockHash = Get-ChessAshFileSha256 (Join-Path $script:ChessAshProjectRoot 'package-lock.json')
    $stamp = Join-Path $script:ChessAshProjectRoot 'node_modules/.chessash-lock.sha256'
    $installed = (Test-Path -LiteralPath $stamp) -and ((Get-Content -Raw -LiteralPath $stamp).Trim() -eq $lockHash) -and (Test-Path -LiteralPath 'node_modules/.bin/vite.cmd') -and (Test-Path -LiteralPath 'node_modules/stockfish/bin/stockfish-19-lite-single.wasm')
    if (-not $installed) {
        Write-Host 'Installing locked build dependencies...'
        $previousSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
        try {
            if ($Platform -eq 'Android') { $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1' }
            Invoke-ChessAshCommand -Command $npm -Arguments @('ci','--no-audit','--no-fund')
        } finally {
            if ($null -eq $previousSkip) { Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue }
            else { $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $previousSkip }
        }
        Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ASCII
    }
    if ($Platform -eq 'Windows' -and -not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
        Write-Host 'Downloading the pinned Electron runtime...'
        Invoke-ChessAshCommand -Command $node -Arguments @('node_modules/electron/install.js')
    }
    foreach ($required in @('resources/foxash/foxash.exe','resources/foxash/LICENSE.txt','resources/foxash/foxash_source_code.tar.gz')) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing bundled Foxash component: $required. See BUILDING.md." }
    }
    if (-not $SkipWebBuild) {
        Invoke-ChessAshCommand -Command $node -Arguments @('scripts/prepare-engine.mjs')
        Invoke-ChessAshCommand -Command $node -Arguments @('scripts/licenses.mjs')
        Invoke-ChessAshCommand -Command $node -Arguments @('scripts/create-pieces.mjs')
        Copy-Item -LiteralPath 'CREDITS.md','THIRD_PARTY_NOTICES.md' -Destination 'public/licenses' -Force
        Invoke-ChessAshCommand -Command $npm -Arguments @('run','build')
    }
    foreach ($required in @('dist/index.html','dist/engine/stockfish.js','dist/engine/stockfish.wasm')) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing application build: $required" }
    }
    Write-Host "Application ready for $Platform packaging."
}
