param(
    [switch]$Debug,
    [ValidateSet('arm64-v8a', 'x86_64')][string]$Abi = 'arm64-v8a',
    [string]$Sdk = $env:ANDROID_HOME
)

$ErrorActionPreference = 'Stop'
$builder = Join-Path $PSScriptRoot '../native/scripts/build-android.ps1'
& $builder -Abi $Abi -Sdk $Sdk -Release:(!$Debug)
