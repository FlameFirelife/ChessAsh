@echo off
setlocal
title ChessAsh v1.5 - Android build
pushd "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-android.ps1" %*
set "CHESSASH_BUILD_EXIT=%ERRORLEVEL%"
popd
if not defined CHESSASH_NO_PAUSE pause
exit /b %CHESSASH_BUILD_EXIT%
