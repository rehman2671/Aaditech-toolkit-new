@echo off
:: ============================================================================
:: Aaditech Enterprise Agent - Single Check-in Tester
:: ============================================================================
title Aaditech Endpoint Agent Test Runner

echo [*] Triggering single telemetry check-in and command execution pass...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Aaditech-Agent.ps1" -Once

echo.
echo Check-in complete. Press any key to exit.
pause >nul
