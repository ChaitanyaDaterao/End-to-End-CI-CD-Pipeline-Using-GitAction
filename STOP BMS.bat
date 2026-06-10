@echo off
title Stopping BMS System
color 0C
echo Shutting down BMS Server and Client...

:: This kills all Node processes (Backend and Serve)
taskkill /F /IM node.exe /T >nul 2>&1

echo.
echo System has been stopped successfully.
timeout /t 3 >nul
exit