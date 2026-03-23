@echo off
echo ╔══════════════════════════════════════════╗
echo ║     Computer Use Agent - Bridge          ║
echo ╚══════════════════════════════════════════╝
echo.

:: Configura aqui tu servidor y session ID
set BRIDGE_SERVER=wss://TU-APP-SERVICE.azurewebsites.net
set BRIDGE_SESSION=%1

if "%BRIDGE_SESSION%"=="" (
    echo ERROR: Pasa el Session ID como argumento: bridge.bat MI_SESSION_ID
    pause
    exit /b 1
)

echo Conectando a %BRIDGE_SERVER%
echo Session: %BRIDGE_SESSION%
echo.

node "%~dp0agent-bridge.js" --server %BRIDGE_SERVER% --session %BRIDGE_SESSION%

if %ERRORLEVEL% neq 0 (
    echo.
    echo Error al iniciar el bridge. Verifica que Node.js y Playwright esten instalados.
    pause
)
