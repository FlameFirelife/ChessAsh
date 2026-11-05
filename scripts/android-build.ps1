param([switch]$SkipWebBuild)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')
Invoke-ChessAshAndroidBuild -Configuration Debug -SkipWebBuild:$SkipWebBuild
