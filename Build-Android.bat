@echo off
setlocal
title ChessAsh - Android build
where pwsh.exe >nul 2>&1
if errorlevel 1 (
    echo PowerShell 7 is required to build ChessAsh.
    if not defined CHESSASH_NO_PAUSE pause
    exit /b 1
)
pushd "%~dp0"
if errorlevel 1 exit /b 1
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android.ps1" %*
set "CHESSASH_BUILD_EXIT=%ERRORLEVEL%"
popd
if not defined CHESSASH_NO_PAUSE pause
exit /b %CHESSASH_BUILD_EXIT%
