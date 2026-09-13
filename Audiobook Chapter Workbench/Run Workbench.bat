@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ========================================================
    echo [!] Virtual environment not detected.
    echo Please run "01 - Setup.bat" first to configure your system.
    echo ========================================================
    pause
    exit /b 1
)

".venv\Scripts\python.exe" -m app.main
pause