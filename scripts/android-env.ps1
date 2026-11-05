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

function Find-ChessAshAndroidSdk([string]$ProjectRoot, $Config) {
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, $Config['androidSdkRoot'])) { if ($candidate) { $candidates.Add($candidate) } }
    $propertiesFile = Join-Path $ProjectRoot 'android\local.properties'
    if (Test-Path -LiteralPath $propertiesFile) {
        foreach ($line in (Get-Content -LiteralPath $propertiesFile)) {
            if ($line -match '^sdk\.dir\s*=\s*(.+)$') { $candidates.Add($Matches[1].Replace('\\', '\').Replace('\:', ':')) }
        }
    }
    $candidates.Add((Join-Path $ProjectRoot 'work\android-sdk'))
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Android\Sdk')) }
    $variables = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'android\variables.gradle')
    if ($variables -notmatch 'compileSdkVersion\s*=\s*(\d+)') { throw 'Cannot read the Android compile SDK version.' }
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

function Invoke-ChessAshAndroidBuild {
    param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release', [switch]$SkipWebBuild)
    $ErrorActionPreference = 'Stop'
    $projectRoot = Split-Path $PSScriptRoot -Parent
    $previousLocation = Get-Location
    $previousEnvironment = @{}
    foreach ($name in @('JAVA_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_HOME', 'GRADLE_USER_HOME', 'CHESSASH_SIGNING_PASSWORD', 'CHESSASH_SIGNING_STORE')) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $signingPassword = $null
    $ownsBuildLock = $false
    try {
        Set-Location -LiteralPath $projectRoot
        . (Join-Path $PSScriptRoot 'build-common.ps1')
        $heldLock = Get-Variable -Name ChessAshBuildLockHeld -ErrorAction SilentlyContinue
        $ownsBuildLock = -not ($heldLock -and [bool]$heldLock.Value)
        Enter-ChessAshBuildLock
        if (-not $SkipWebBuild) {
            Initialize-ChessAshBuild -Platform Android
        }
        if (-not (Test-Path -LiteralPath 'dist\index.html')) { throw 'The application UI has not been built. Run Build-Android.bat first.' }
        $config = Get-ChessAshBuildEnvironment $projectRoot
        $env:JAVA_HOME = Find-ChessAshJava21 $config
        $sdk = Find-ChessAshAndroidSdk $projectRoot $config
        $env:ANDROID_SDK_ROOT = $sdk.Root
        $env:ANDROID_HOME = $sdk.Root
        if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = if ($config['gradleUserHome']) { $config['gradleUserHome'] } else { Join-Path $projectRoot 'work\gradle' } }
        $version = Get-ChessAshAndroidVersion $projectRoot
        $cap = Join-Path $projectRoot 'node_modules\.bin\cap.cmd'
        if (-not (Test-Path -LiteralPath $cap)) { throw 'Capacitor dependencies are missing. Run Build-Android.bat first.' }
        $propertyPath = Join-Path $projectRoot 'android\local.properties'
        $properties = @()
        if (Test-Path -LiteralPath $propertyPath) { $properties = @(Get-Content -LiteralPath $propertyPath | Where-Object { $_ -notmatch '^sdk\.dir\s*=' }) }
        $properties += 'sdk.dir=' + $sdk.Root.Replace('\', '/')
        [IO.File]::WriteAllLines($propertyPath, [string[]]$properties, (New-Object Text.UTF8Encoding($false)))
        Write-Host "Android $Configuration build: ChessAsh $($version.Name), version code $($version.Code), JDK 21, SDK $($sdk.Api)."
        if ($Configuration -eq 'Release') {
            $privateRoot = Join-Path $projectRoot '.private'
            New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
            $storePath = Join-Path $privateRoot 'android-release.jks'
            $passwordPath = Join-Path $privateRoot 'android-signing-password.dpapi'
            $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
            if (-not (Test-Path -LiteralPath $storePath)) {
                if (Test-Path -LiteralPath $passwordPath) { throw 'Signing password exists without its key. Restore the matching key; the build will not replace it.' }
                $bytes = New-Object byte[] 32
                $random = [Security.Cryptography.RandomNumberGenerator]::Create()
                try { $random.GetBytes($bytes) } finally { $random.Dispose() }
                $signingPassword = [Convert]::ToBase64String($bytes)
                [IO.File]::WriteAllText($passwordPath, (Protect-ChessAshSigningPassword $signingPassword), (New-Object Text.UTF8Encoding($false)))
                $env:CHESSASH_SIGNING_PASSWORD = $signingPassword
                & $keytool -genkeypair -keystore $storePath -storepass:env CHESSASH_SIGNING_PASSWORD -keypass:env CHESSASH_SIGNING_PASSWORD -alias chessash -dname 'CN=ChessAsh local build' -keyalg RSA -keysize 3072 -validity 10000 -storetype PKCS12
                if ($LASTEXITCODE) { throw 'Android signing key creation failed. Existing signing files have been preserved.' }
            } else {
                if (-not (Test-Path -LiteralPath $passwordPath)) { throw 'The signing key has no matching encrypted password. Restore the password file; the build will not replace the key.' }
                try { $signingPassword = Unprotect-ChessAshSigningPassword ([IO.File]::ReadAllText($passwordPath)) }
                catch { throw 'The signing password cannot be decrypted by this Windows account. Restore the matching password on its original account or migrate the key securely.' }
                $env:CHESSASH_SIGNING_PASSWORD = $signingPassword
            }
            $env:CHESSASH_SIGNING_STORE = $storePath
            $certificate = Get-AndroidProcessOutput $keytool @('-exportcert', '-rfc', '-keystore', $storePath, '-storepass:env', 'CHESSASH_SIGNING_PASSWORD', '-alias', 'chessash')
            if ($certificate.ExitCode -ne 0 -or $certificate.Text -notmatch '(?s)-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----') { throw 'The existing signing key could not be opened. Its files have not been replaced.' }
            $certBytes = [Convert]::FromBase64String(($Matches[1] -replace '\s', ''))
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $expectedCertificate = ([BitConverter]::ToString($sha.ComputeHash($certBytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        }
        & $cap sync android
        if ($LASTEXITCODE) { throw 'Capacitor Android sync failed.' }
        & (Join-Path $projectRoot 'android\gradlew.bat') -p android "assemble$Configuration" --console=plain "-PchessashVersion=$($version.Name)" "-PchessashVersionCode=$($version.Code)"
        if ($LASTEXITCODE) { throw "Android $Configuration compilation failed." }
        $kind = $Configuration.ToLowerInvariant()
        $built = Join-Path $projectRoot "android\app\build\outputs\apk\$kind\app-$kind.apk"
        if (-not (Test-Path -LiteralPath $built)) { throw 'Gradle did not produce the expected APK.' }
        $verification = & (Join-Path $sdk.BuildTools 'apksigner.bat') verify --verbose --print-certs $built
        if ($LASTEXITCODE) { throw 'APK signature verification failed.' }
        $verifiedText = $verification -join "`n"
        if ($verifiedText -notmatch 'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)') { throw 'The APK signer certificate could not be read.' }
        $actualCertificate = $Matches[1].ToLowerInvariant()
        if ($Configuration -eq 'Release' -and $actualCertificate -ne $expectedCertificate) { throw 'The APK does not match the preserved release signing key.' }
        $badging = & (Join-Path $sdk.BuildTools 'aapt.exe') dump badging $built
        if ($LASTEXITCODE -or (($badging -join "`n") -notmatch "versionCode='$($version.Code)' versionName='$([regex]::Escape($version.Name))'")) { throw 'The built APK version does not match the release metadata.' }
        $suffix = if ($Configuration -eq 'Debug') { '-debug' } else { '' }
        $destination = Join-Path $projectRoot "release\ChessAsh-$($version.Name)-android$suffix.apk"
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $built -Destination $destination -Force
        $hash = Get-ChessAshAndroidFileHash $destination
        $report = [ordered]@{ product = 'ChessAsh'; version = $version.Name; androidVersionCode = $version.Code; configuration = $Configuration; signatureVerified = $true; certificateSha256 = $actualCertificate; apkSha256 = $hash; apk = (Split-Path $destination -Leaf); verifiedAt = [DateTime]::UtcNow.ToString('o') }
        [IO.File]::WriteAllText(($destination + '.build.json'), ($report | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        Write-Host "APK ready: $destination"
        Write-Host "Signature verified. SHA-256: $hash"
    } finally {
        if ($ownsBuildLock -and (Get-Command Exit-ChessAshBuildLock -ErrorAction SilentlyContinue)) { Exit-ChessAshBuildLock }
        foreach ($name in $previousEnvironment.Keys) {
            if ($null -eq $previousEnvironment[$name]) { Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue }
            else { Set-Item -LiteralPath ("Env:" + $name) -Value $previousEnvironment[$name] }
        }
        $signingPassword = $null
        Set-Location -LiteralPath $previousLocation.Path
    }
}
