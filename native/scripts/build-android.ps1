param(
    [ValidateSet('arm64-v8a', 'x86_64')]
    [string]$Abi = 'arm64-v8a',
    [string]$Sdk = $env:ANDROID_HOME,
    [switch]$InPlace,
    [switch]$Release
)
$ErrorActionPreference = 'Stop'
$native = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $native
$signedUpdate = $InPlace -or $Release
. (Join-Path $projectRoot 'scripts/android-env.ps1')
$config = Get-ChessAshBuildEnvironment $projectRoot
$sdkInfo = Find-ChessAshAndroidSdk $projectRoot $config $Sdk
$env:ANDROID_HOME = $sdkInfo.Root
$env:ANDROID_SDK_ROOT = $sdkInfo.Root
$env:JAVA_HOME = Find-ChessAshJava21 $config
if ($config['gradleUserHome'] -and !$env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = $config['gradleUserHome'] }
$env:ANDROID_NDK_HOME = Join-Path $sdkInfo.Root 'ndk/28.2.13676358'
if (!(Test-Path $env:ANDROID_NDK_HOME)) { throw 'Install Android NDK 28.2.13676358.' }
if (!(Test-Path (Join-Path $native "engines/android/$Abi/libstockfish.so")) -or
    !(Test-Path (Join-Path $native "engines/android/$Abi/libfoxash.so"))) {
    throw "Run native/scripts/prepare-engines.ps1 -Platform Android -Abi $Abi -Ndk '$env:ANDROID_NDK_HOME' first."
}
$staging = Join-Path $native 'android/app/src/main/jniLibs'
$rustArgs = @()
$variant = if ($signedUpdate) { 'release' } else { 'debug' }
$task = if ($signedUpdate) { ':app:assembleRelease' } else { ':app:assembleDebug' }
$gradleArgs = @("-PchessashAbi=$Abi", $task)
if ($Release) {
    $rustArgs = @('--release')
}
if ($signedUpdate) { $gradleArgs += '-PchessashInPlace=true' }
$signerStore = $env:CHESSASH_SIGNING_STORE
$signerPassword = $env:CHESSASH_SIGNING_PASSWORD
Push-Location $native
try {
    if ($signedUpdate) {
        $storePath = Join-Path $projectRoot '.private/android-release.jks'
        $passwordPath = Join-Path $projectRoot '.private/android-signing-password.dpapi'
        if (!(Test-Path -LiteralPath $storePath) -or !(Test-Path -LiteralPath $passwordPath)) {
            throw 'Restore the existing ChessAsh Android key and its password file to build an update.'
        }
        $env:CHESSASH_SIGNING_STORE = $storePath
        $env:CHESSASH_SIGNING_PASSWORD = Unprotect-ChessAshSigningPassword ([IO.File]::ReadAllText($passwordPath))
        $keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
        $certificate = Get-AndroidProcessOutput $keytool @('-exportcert', '-rfc', '-keystore', $storePath, '-storepass:env', 'CHESSASH_SIGNING_PASSWORD', '-alias', 'chessash')
        if ($certificate.ExitCode -ne 0 -or $certificate.Text -notmatch '(?s)-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----') {
            throw 'Could not open the existing ChessAsh signing key.'
        }
        $certBytes = [Convert]::FromBase64String(($Matches[1] -replace '\s', ''))
        $expectedCertificate = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($certBytes)).ToLowerInvariant()
    }
    $env:CARGO_NDK_PLATFORM = '24'
    cargo ndk -t $Abi -o $staging build --lib @rustArgs
    if ($LASTEXITCODE) { throw 'Rust Android build failed.' }
    $gradle = Join-Path $native 'android/gradlew.bat'
    & $gradle --project-dir (Join-Path $native 'android') @gradleArgs
    if ($LASTEXITCODE) { throw 'Android APK packaging failed.' }
    $built = Join-Path $native "android/app/build/outputs/apk/$variant/app-$variant.apk"
    $previewDir = Join-Path $native 'runtime/previews'
    $name = "ChessAshNative-$Abi.apk"
    if ($signedUpdate) {
        $verification = & (Join-Path $sdkInfo.BuildTools 'apksigner.bat') verify --print-certs $built
        if ($LASTEXITCODE -ne 0 -or ($verification -join "`n") -notmatch 'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]+)' -or $Matches[1].ToLowerInvariant() -ne $expectedCertificate) {
            throw 'The APK does not match the existing ChessAsh signing key.'
        }
        $version = Get-ChessAshAndroidVersion $projectRoot
        $badging = & (Join-Path $sdkInfo.BuildTools 'aapt.exe') dump badging $built
        if ($LASTEXITCODE -ne 0 -or ($badging -join "`n") -notmatch "package: name='dev.flamedev.chessash' versionCode='$($version.Code)' versionName='$([regex]::Escape($version.Name))'") {
            throw 'The update package or version does not match ChessAsh.'
        }
        $name = "ChessAsh-$($version.Name)-android-$Abi.apk"
    }
    New-Item -ItemType Directory -Path $previewDir -Force | Out-Null
    $apk = Join-Path $previewDir $name
    Copy-Item -LiteralPath $built -Destination $apk -Force
    Write-Output $apk
} finally {
    $env:CHESSASH_SIGNING_STORE = $signerStore
    $env:CHESSASH_SIGNING_PASSWORD = $signerPassword
    Pop-Location
}
