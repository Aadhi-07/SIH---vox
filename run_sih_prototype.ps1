# VoxGuard - Smart India Hackathon Prototype Launcher (PowerShell)
$Host.UI.RawUI.WindowTitle = "VoxGuard - SIH Prototype Launcher"
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "  VOXGUARD: NATIONAL AI VOICE-CLONE & TELECOM DEEPFAKE DEFENSE SYSTEM" -ForegroundColor White
Write-Host "  Smart India Hackathon Prototype | Ministry of Home Affairs / I4C Alignment" -ForegroundColor Yellow
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Detect Python
$pythonExe = Join-Path $baseDir ".tools\python\python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        $pythonExe = "python"
        Write-Host "[+] Using system Python" -ForegroundColor Green
    } else {
        Write-Host "[-] Python not found. Please install Python or verify .tools/python." -ForegroundColor Red
        Exit 1
    }
} else {
    Write-Host "[+] Using embedded Python: $pythonExe" -ForegroundColor Green
}

# 2. Check Node
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Host "[-] NPM / Node.js not found in PATH." -ForegroundColor Red
    Exit 1
}
Write-Host "[+] Node and NPM verified." -ForegroundColor Green

# 3. Start Backend
Write-Host "[*] Launching VoxGuard Backend API on Port 8000..." -ForegroundColor Cyan
$backendProc = Start-Process -FilePath $pythonExe -ArgumentList "-m uvicorn api.main:app --host 127.0.0.1 --port 8000" -WorkingDirectory $baseDir -PassThru

Start-Sleep -Seconds 3

# 4. Start Dashboard
Write-Host "[*] Launching VoxGuard Verifier Dashboard on Port 5173..." -ForegroundColor Cyan
$dashDir = Join-Path $baseDir "dashboard"
$dashProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory $dashDir -PassThru

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "  [SUCCESS] All VoxGuard Services Running!" -ForegroundColor Green
Write-Host "  - SOC Console:       http://localhost:5173" -ForegroundColor White
Write-Host "  - WebRTC Live Call:  http://localhost:5173/?view=call&room=demo-call" -ForegroundColor White
Write-Host "  - API Documentation: http://localhost:8000/docs" -ForegroundColor White
Write-Host "  - I4C Dossier Demo:  http://localhost:8000/calls/call-digital-arrest/dossier/html" -ForegroundColor White
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:5173"

Write-Host "Press Ctrl+C or Enter to stop all prototype services..." -ForegroundColor Yellow
[Console]::ReadLine() | Out-Null

Write-Host "Stopping background processes..." -ForegroundColor DarkYellow
if ($backendProc -and -not $backendProc.HasExited) { Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue }
if ($dashProc -and -not $dashProc.HasExited) { Stop-Process -Id $dashProc.Id -Force -ErrorAction SilentlyContinue }
Write-Host "Done." -ForegroundColor Green
