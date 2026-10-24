@echo off
rem Double-click to search for new deals with your Claude plan and upload them to Deal Radar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\search-and-upload.ps1"
echo.
pause
