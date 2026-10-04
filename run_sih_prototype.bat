@echo off
setlocal enabledelayedexpansion
title VoxGuard - Smart India Hackathon Prototype Launcher
color 0B

echo ===============================================================================
echo   VOXGUARD: NATIONAL AI VOICE-CLONE & TELECOM DEEPFAKE DEFENSE SYSTEM
echo   Smart India Hackathon Prototype | Ministry of Home Affairs / I4C Alignment
echo ===============================================================================
echo.

:: 1. Detect Python Executable
set PYTHON_EXE=
if exist "%~dp0.tools\python\python.exe" (
    set "PYTHON_EXE=%~dp0.tools\python\python.exe"
    echo [+] Using embedded project Python: !PYTHON_EXE!
) else (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYTHON_EXE=python"
        echo [+] Using system Python
    ) else (
        echo [-] Error: Python was not found. Please install Python 3.10+ or check .tools/python.
        pause
        exit /b 1
    )
)

:: 2. Check Node & NPM
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [-] Error: Node.js / npm not found in PATH. Please install Node.js.
    pause
    exit /b 1
)
echo [+] Node and NPM detected.

:: 3. Start Backend in separate window
echo.
echo [*] Starting VoxGuard FastAPI Backend on port 8000...
start "VoxGuard Backend (Port 8000)" cmd /k "title VoxGuard API Server && cd /d "%~dp0" && "%PYTHON_EXE%" -m uvicorn api.main:app --host 127.0.0.1 --port 8000"

:: 4. Wait 3 seconds for backend initialization
timeout /t 3 /nobreak >nul

:: 5. Start Dashboard in separate window
echo [*] Starting VoxGuard Operations Dashboard on port 5173...
start "VoxGuard SOC Dashboard (Port 5173)" cmd /k "title VoxGuard Dashboard && cd /d "%~dp0dashboard" && npm run dev"

:: 6. Wait 3 seconds and launch browser
timeout /t 3 /nobreak >nul
echo.
echo ===============================================================================
echo   [SUCCESS] VoxGuard SIH Prototype is running!
echo   - SOC Operations Console: http://localhost:5173
echo   - WebRTC Live Two-Way:    http://localhost:5173/?view=call&room=demo-call
echo   - Backend API Docs:       http://localhost:8000/docs
echo   - I4C Dossier Demo:       http://localhost:8000/calls/call-digital-arrest/dossier/html
echo ===============================================================================
echo.
echo Opening browser to dashboard...
start http://localhost:5173

echo.
echo Press any key to stop all prototype services...
pause >nul

echo Stopping services...
taskkill /FI "WINDOWTITLE eq VoxGuard API Server*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq VoxGuard Dashboard*" /T /F >nul 2>nul
echo Done.
