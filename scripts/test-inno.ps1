param([string]$Compiler = (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$testRoot = [IO.Path]::GetFullPath((Join-Path $root 'work\inno-tests'))
if (-not $testRoot.StartsWith([IO.Path]::GetFullPath((Join-Path $root 'work')) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test workspace.' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$functionReport = Join-Path $testRoot 'path-functions.json'
Remove-Item -LiteralPath $functionReport -ErrorAction SilentlyContinue
& $Compiler /Q (Join-Path $root 'installer\tests\PathHarness.iss')
if ($LASTEXITCODE) { throw 'PATH harness compilation failed.' }
$process = Start-Process -FilePath (Join-Path $testRoot 'path-functions.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', "/REPORT=`"$functionReport`"") -PassThru -Wait -WindowStyle Hidden
if (-not (Test-Path -LiteralPath $functionReport)) { throw "PATH function checks failed (exit $($process.ExitCode))." }

$fixture = Join-Path $testRoot 'fixture'
$docs = Join-Path $testRoot 'docs'
$install = Join-Path $testRoot 'installed'
New-Item -ItemType Directory -Path $fixture,$docs -Force | Out-Null
Set-Content -LiteralPath (Join-Path $fixture 'ChessAsh.exe') -Value 'Installer fixture only. Not executable.'
Set-Content -LiteralPath (Join-Path $docs 'README.md') -Value 'Installer test fixture.'
foreach ($version in @('0.9.9','1.0.0')) {
    & $Compiler /Q '/DTestBuild=1' "/DAppVersion=$version" "/DProjectRoot=$root" "/DAppSourceDir=$fixture" "/DAppDocsDir=$docs" "/DInstallerOutputDir=$testRoot" (Join-Path $root 'installer\ChessAsh.iss')
    if ($LASTEXITCODE) { throw "Installer test compilation failed for $version." }
}
$namespace = 'HKCU:\Software\ChessAsh\InstallerTest'
$environment = "$namespace\Environment"
$ownership = "$namespace\Ownership"
$initial = 'C:\Keep;"C:\Example\tools\";C:\ChessAshExtra'
if (Test-Path -LiteralPath $namespace) { throw 'A previous installer test registry namespace exists. Inspect it before testing.' }
$actualPathBefore = [Environment]::GetEnvironmentVariable('Path','User')
function Invoke-Installer([string]$Version) {
    $exe = Join-Path $testRoot "ChessAsh-Installer-Test-$Version.exe"
    $run = Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/TASKS=addtopath',"/DIR=`"$install`"", "/LOG=`"$(Join-Path $testRoot ('install-'+$Version+'.log'))`"") -Wait -PassThru -WindowStyle Hidden
    if ($run.ExitCode) { throw "Installer test exited $($run.ExitCode)." }
}
function Invoke-Uninstaller {
    $run = Start-Process -FilePath (Join-Path $install 'unins000.exe') -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -Wait -PassThru -WindowStyle Hidden
    if ($run.ExitCode) { throw "Uninstaller test exited $($run.ExitCode)." }
}
try {
    New-Item -Path $environment -Force | Out-Null
    New-ItemProperty -LiteralPath $environment -Name Path -Value $initial -PropertyType ExpandString -Force | Out-Null
    Invoke-Installer '0.9.9'
    $first = (Get-ItemProperty -LiteralPath $environment).Path
    if ($first -ne "$initial;$install") { throw 'Installer did not append the exact PATH token.' }
    Set-Content -LiteralPath (Join-Path $install 'user-created-file.txt') -Value 'Keep on update.'
    Invoke-Installer '1.0.0'
    $afterUpgrade = (Get-ItemProperty -LiteralPath $environment).Path
    if ($afterUpgrade -ne $first) { throw 'Upgrade duplicated or changed PATH.' }
    if ((Get-Content -LiteralPath (Join-Path $install 'user-created-file.txt') -Raw).Trim() -ne 'Keep on update.') { throw 'Upgrade removed an unrelated local file.' }
    New-ItemProperty -LiteralPath $environment -Name Path -Value "$afterUpgrade;C:\AddedLater" -PropertyType ExpandString -Force | Out-Null
    Invoke-Uninstaller
    $afterUninstall = (Get-ItemProperty -LiteralPath $environment).Path
    if ($afterUninstall -ne "$initial;C:\AddedLater") { throw 'Uninstall did not preserve unrelated PATH changes.' }
    if (Test-Path -LiteralPath (Join-Path $install 'ChessAsh.exe')) { throw 'Installed executable was not removed.' }
    $preexisting = "$initial;`"$install\`""
    New-ItemProperty -LiteralPath $environment -Name Path -Value $preexisting -PropertyType ExpandString -Force | Out-Null
    Invoke-Installer '1.0.0'
    if ((Get-ItemProperty -LiteralPath $ownership).OwnsPath -ne 0) { throw 'Installer claimed ownership of an existing PATH token.' }
    Invoke-Uninstaller
    if ((Get-ItemProperty -LiteralPath $environment).Path -ne $preexisting) { throw 'Uninstall removed a preexisting PATH token.' }
    if ([Environment]::GetEnvironmentVariable('Path','User') -ne $actualPathBefore) { throw 'Actual user PATH changed unexpectedly.' }
    @{passed=$true;versionUpgrade='0.9.9 -> 1.0.0';pathFunctionChecks=7;checks=@('checked PATH task','no duplicate on upgrade','unrelated files survive upgrade','unrelated PATH edits survive uninstall','preexisting token remains unowned','actual user PATH untouched')} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $testRoot 'installer-results.json')
    Write-Host 'Inno installer checks passed with an isolated registry namespace; actual user PATH unchanged.'
} finally {
    if (Test-Path -LiteralPath (Join-Path $install 'unins000.exe')) { try { Invoke-Uninstaller } catch { Write-Warning $_ } }
    if (Test-Path -LiteralPath $namespace) { Remove-Item -LiteralPath $namespace -Recurse -Force }
}
