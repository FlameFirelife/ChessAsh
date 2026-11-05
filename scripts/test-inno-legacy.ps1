$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$legacyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dc27b760-2c31-5d3e-8bbe-268581f01223'
$innoKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dc27b760-2c31-5d3e-8bbe-268581f01223_is1'
$ownedLegacy = [IO.Path]::GetFullPath((Join-Path $root 'work\installed'))
$useExisting = $false
foreach ($key in @($legacyKey,$innoKey,'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dc27b760-2c31-5d3e-8bbe-268581f01223')) {
    if (Test-Path -LiteralPath $key) {
        if ($key -ne $legacyKey) { throw 'An existing ChessAsh installation is registered. The isolated legacy test will not replace it.' }
        $location = (Get-ItemProperty -LiteralPath 'HKCU:\Software\dc27b760-2c31-5d3e-8bbe-268581f01223').InstallLocation
        if ([IO.Path]::GetFullPath($location) -ne $ownedLegacy) { throw 'An existing ChessAsh install is outside the explicitly authorized earlier test folder.' }
        $useExisting = $true
    }
}
$testRoot = [IO.Path]::GetFullPath((Join-Path $root 'work\inno-legacy-test'))
if (-not $testRoot.StartsWith([IO.Path]::GetFullPath((Join-Path $root 'work')) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test folder.' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$install = $ownedLegacy
$legacy = Join-Path $root 'release\ChessAsh Setup 1.0.0.exe'
$current = Join-Path $root 'release\ChessAsh-Setup-1.0.0.exe'
foreach ($file in @($legacy,$current)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installer fixture: $file" } }
$environment = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
try { $pathBefore = $environment.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $environment.Dispose() }
$profileRoot = Join-Path $env:APPDATA 'chessash'
$sentinel = Join-Path $profileRoot ('inno-migration-test-' + [Guid]::NewGuid().ToString('N') + '.txt')
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
Set-Content -LiteralPath $sentinel -Value 'Preserve this app-data fixture through installer migration.'
try {
    if (-not $useExisting) {
        $old = Start-Process -FilePath $legacy -ArgumentList @('/S',"/D=$install") -Wait -PassThru -WindowStyle Hidden
        if ($old.ExitCode) { throw "Legacy NSIS fixture exited $($old.ExitCode)." }
    }
    if (-not (Test-Path -LiteralPath $legacyKey)) { throw 'Legacy fixture did not register.' }
    $upgrade = Start-Process -FilePath $current -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/MERGETASKS=!addtopath,!desktopicon',"/DIR=`"$install`"", "/LOG=`"$(Join-Path $testRoot 'migration.log')`"") -Wait -PassThru -WindowStyle Hidden
    if ($upgrade.ExitCode) { throw "Inno migration exited $($upgrade.ExitCode)." }
    if (Test-Path -LiteralPath $legacyKey) { throw 'Legacy uninstall registration remains.' }
    if (-not (Test-Path -LiteralPath $innoKey)) { throw 'Inno installation was not registered.' }
    if (-not (Test-Path -LiteralPath (Join-Path $install 'ChessAsh.exe'))) { throw 'Migrated application missing.' }
    foreach ($file in @('README.md','LICENSE','CREDITS.md','THIRD_PARTY_NOTICES.md','BUILDING.md')) { if (-not (Test-Path -LiteralPath (Join-Path $install "docs\$file"))) { throw "Installed documentation missing: $file" } }
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'App-data fixture was removed during migration.' }
    $environment = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    try { $pathAfter = $environment.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $environment.Dispose() }
    if ($pathAfter -ne $pathBefore) { throw 'Actual user PATH changed during a PATH-disabled test.' }
    @{passed=$true;checks=@('real NSIS-to-Inno migration','same installation directory','legacy registration removed','Inno registration created','documentation installed','app data preserved','actual user PATH unchanged');installDirectory=$install} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $testRoot 'legacy-results.json')
    Write-Host 'Legacy NSIS to Inno migration passed; app data and actual user PATH preserved.'
} finally {
    $uninstaller = Join-Path $install 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Wait -WindowStyle Hidden }
    elseif (Test-Path -LiteralPath (Join-Path $install 'Uninstall ChessAsh.exe')) {
        $oldUninstaller = Join-Path $testRoot 'legacy-uninstaller.exe'
        Copy-Item -LiteralPath (Join-Path $install 'Uninstall ChessAsh.exe') -Destination $oldUninstaller -Force
        Start-Process -FilePath $oldUninstaller -ArgumentList @('/S','/currentuser','--updated',"_?=$install") -WorkingDirectory $testRoot -Wait -WindowStyle Hidden
    }
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
}
