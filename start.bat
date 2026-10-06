@echo off
setlocal

:: Check if node is in PATH
where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    node index.js
    pause
    exit /b 0
)

:: Check Visual Studio bundled Node.js path
set "VS_NODE=C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe"
if exist "%VS_NODE%" (
    "%VS_NODE%" index.js
    pause
    exit /b 0
)

echo [ERROR] Node.js was not found in PATH or the standard Visual Studio installation directory.
echo Please install Node.js from https://nodejs.org/ and try again.
pause
