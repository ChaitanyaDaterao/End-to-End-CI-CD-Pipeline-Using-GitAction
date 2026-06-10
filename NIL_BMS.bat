@echo off
title BMS - Building Material Management System
color 0A

:: 1. SET THE NODE DIRECTORY
set "NODE_DIR=C:\Program Files\nodejs" 

echo --------------------------------
echo Starting BMS System...
echo DEVELOPED BY CHAITANYA H DATERAO
echo --------------------------------

:: 2. VERIFY FOLDER ACCESS
if not exist "%NODE_DIR%" (
    echo ERROR: The folder %NODE_DIR% does not exist. 
    pause
    exit /b
) 

:: 3. ADD NODE FOLDER TO THE TEMPORARY PATH
set "PATH=%NODE_DIR%;%PATH%" 

echo [1/1] Initializing Server...
echo Please wait for the Dashboard to open automatically.
echo ---------------------------------

:: 4. BACKGROUND BROWSER LAUNCHER
:: This waits 8 seconds in the background then opens the site
start /min cmd /c "timeout /t 8 /nobreak >nul && start http://localhost:5000"

:: 5. LAUNCH THE SERVER DIRECTLY
:: This keeps the logs in your current green window
cd /d C:\Murum\bms\server && node index.js 

pause