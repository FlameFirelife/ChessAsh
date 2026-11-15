function ConvertTo-AndroidProcessArgument([string]$Value) {
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = $Value -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Get-AndroidProcessOutput([string]$Executable, [string[]]$Arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-AndroidProcessArgument $_ }) -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'Could not start Android build tool.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Android tool inspection timed out.' }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Text = $stdout.GetAwaiter().GetResult() + "`n" + $stderr.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}

function Get-ChessAshBuildEnvironment([string]$ProjectRoot) {
    $configFile = Join-Path $ProjectRoot '.private\build-env.json'
    if (-not (Test-Path -LiteralPath $configFile)) { return @{} }
    try { $config = Get-Content -Raw -LiteralPath $configFile | ConvertFrom-Json }
    catch { throw 'The local .private/build-env.json file is not valid JSON.' }
    $values = @{}
    foreach ($name in @('javaHome', 'androidSdkRoot', 'gradleUserHome')) {
        $property = $config.PSObject.Properties[$name]
        if ($property -and $property.Value) { $values[$name] = [string]$property.Value }
    }
    return $values
}

function Find-ChessAshJava21($Config) {
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @($env:JAVA_HOME, $Config['javaHome'])) { if ($candidate) { $candidates.Add($candidate) } }
    $javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($javaCommand) {
        try {
            $properties = Get-AndroidProcessOutput $javaCommand.Source @('-XshowSettings:properties', '-version')
            if ($properties.Text -match '(?m)^\s*java\.home\s*=\s*(.+)$') { $candidates.Add($Matches[1].Trim()) }
        } catch {}
    }
    foreach ($folder in @((Join-Path $env:ProgramFiles 'Java'), (Join-Path $env:ProgramFiles 'Eclipse Adoptium'), (Join-Path $env:ProgramFiles 'Microsoft'))) {
        if (Test-Path -LiteralPath $folder) {
            foreach ($item in (Get-ChildItem -LiteralPath $folder -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'jdk|java|temurin' })) { $candidates.Add($item.FullName) }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $java = Join-Path $candidate 'bin\java.exe'
        $keytool = Join-Path $candidate 'bin\keytool.exe'
        if (-not (Test-Path -LiteralPath $java) -or -not (Test-Path -LiteralPath $keytool)) { continue }
        try {
            $version = Get-AndroidProcessOutput $java @('-version')
            if ($version.ExitCode -eq 0 -and $version.Text -match 'version\s+"21(?:\.|\s|")') { return [IO.Path]::GetFullPath($candidate) }
        } catch {}
    }
    throw 'JDK 21 was not found. Install JDK 21 and set JAVA_HOME or javaHome in .private/build-env.json. A Java 17 installation is not sufficient.'
}

function Find-ChessAshAndroidSdk([string]$ProjectRoot, $Config, [string]$ExplicitSdk) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($ExplicitSdk) {
        $candidates.Add($ExplicitSdk)
    } else {
        foreach ($candidate in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, $Config['androidSdkRoot'])) { if ($candidate) { $candidates.Add($candidate) } }
        $propertiesFile = Join-Path $ProjectRoot 'native\android\local.properties'
        if (Test-Path -LiteralPath $propertiesFile) {
            foreach ($line in (Get-Content -LiteralPath $propertiesFile)) {
                if ($line -match '^sdk\.dir\s*=\s*(.+)$') { $candidates.Add($Matches[1].Replace('\\', '\').Replace('\:', ':')) }
            }
        }
        $candidates.Add((Join-Path $ProjectRoot 'work\android-sdk'))
        if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Android\Sdk')) }
    }
    $variables = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'native\android\app\build.gradle')
    if ($variables -notmatch '(?m)^\s*compileSdk\s+(\d+)') { throw 'Cannot read the native Android compile SDK version.' }
    $api = $Matches[1]
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath (Join-Path $candidate "platforms\android-$api\android.jar"))) { continue }
        $toolsRoot = Join-Path $candidate 'build-tools'
        if (-not (Test-Path -LiteralPath $toolsRoot)) { continue }
        $tools = Get-ChildItem -LiteralPath $toolsRoot -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat')) } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
        if ($tools) { return [pscustomobject]@{ Root = [IO.Path]::GetFullPath($candidate); BuildTools = $tools.FullName; Api = $api } }
    }
    throw "Android SDK platform $api and build tools were not found. Set ANDROID_SDK_ROOT or androidSdkRoot in .private/build-env.json to a complete Android SDK installation."
}

function Get-ChessAshAndroidVersion([string]$ProjectRoot) {
    $package = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$') { throw 'package.json contains an invalid application version.' }
    $code = 1
    $releaseFile = Join-Path $ProjectRoot 'build\release.json'
    if (Test-Path -LiteralPath $releaseFile) {
        $release = Get-Content -Raw -LiteralPath $releaseFile | ConvertFrom-Json
        if ($release.PSObject.Properties['androidVersionCode']) {
            if ([string]$release.androidVersionCode -notmatch '^\d+$') { throw 'androidVersionCode must be a whole positive number.' }
            $code = [long]$release.androidVersionCode
        }
    }
    if ($code -lt 1 -or $code -gt 2100000000) { throw 'androidVersionCode must be an integer from 1 to 2100000000.' }
    return [pscustomobject]@{ Name = $version; Code = $code }
}

function Get-ChessAshAndroidFileHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Initialize-ChessAshPasswordProtection {
    if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {
        foreach ($folder in @([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory(), $PSHOME)) {
            foreach ($name in @('System.Security.Cryptography.ProtectedData.dll', 'System.Security.dll')) {
                $assembly = Join-Path $folder $name
                if (Test-Path -LiteralPath $assembly) {
                    [void][Reflection.Assembly]::LoadFrom($assembly)
                    if ('System.Security.Cryptography.ProtectedData' -as [type]) { return }
                }
            }
        }
        throw 'Windows credential protection is unavailable in this PowerShell installation.'
    }
}

function Protect-ChessAshSigningPassword([string]$Password) {
    Initialize-ChessAshPasswordProtection
    $bytes = [Text.Encoding]::Unicode.GetBytes($Password)
    try {
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        return ([BitConverter]::ToString($encrypted)).Replace('-', '').ToLowerInvariant()
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Unprotect-ChessAshSigningPassword([string]$Encoded) {
    Initialize-ChessAshPasswordProtection
    $hex = $Encoded.Trim()
    if ($hex -notmatch '^(?:[0-9a-fA-F]{2})+$') { throw 'The signing password file is not a supported Windows-protected credential.' }
    $encrypted = New-Object byte[] ($hex.Length / 2)
    for ($index = 0; $index -lt $encrypted.Length; $index++) { $encrypted[$index] = [Convert]::ToByte($hex.Substring($index * 2, 2), 16) }
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { return [Text.Encoding]::Unicode.GetString($bytes) }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}
