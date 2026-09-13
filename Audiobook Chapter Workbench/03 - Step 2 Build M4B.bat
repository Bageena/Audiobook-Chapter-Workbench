@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Run "01 - Setup.bat" first.
    pause
    exit /b 1
)
".venv\Scripts\python.exe" "app\main.py" --step 2
pause