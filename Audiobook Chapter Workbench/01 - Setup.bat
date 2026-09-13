@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  Audiobook Chapter Workbench - Environment Setup
echo ========================================================
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3.10 or 3.11 is not found in your PATH.
    echo Please install Python and ensure "Add python.exe to PATH" is checked.
    pause
    exit /b 1
)

if not exist ".venv" (
    echo [*] Creating virtual environment .venv...
    python -m venv .venv
)

echo [*] Launching internal setup routine...
".venv\Scripts\python.exe" "app\setup.py"
pause