@echo off
cd "%~dp0"

:: Killing process wsserver.py
FOR /F "tokens=2 delims=," %%i IN ('tasklist /nh /fi "imagename eq wsserver.exe" /fo csv') DO (
    echo Killing process: %%i
    taskkill /PID %%i
)

.\wsserver.exe