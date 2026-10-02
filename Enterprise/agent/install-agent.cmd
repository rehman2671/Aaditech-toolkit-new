@echo off
:: ============================================================================
:: Aaditech Enterprise Agent - Universal Windows Deployment Script
:: Compatible with Windows 10, 11, and Windows Server 2016/2019/2022
:: ============================================================================
setlocal EnableDelayedExpansion
title Aaditech Endpoint Agent Installer

echo.
echo ============================================================================
echo   Aaditech Enterprise Endpoint Agent Installer
echo ============================================================================
echo.

:: 1. Administrative Privilege Verification
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Administrative privileges are required.
    echo Please right-click install-agent.cmd and choose "Run as Administrator".
    echo.
    pause
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"
set "TARGET_DIR=C:\ProgramData\AaditechAgent"

echo [*] Target Directory: %TARGET_DIR%
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

:: 2. Copy Agent and Configuration
echo [*] Deploying agent script and configuration...
copy /y "%SCRIPT_DIR%Aaditech-Agent.ps1" "%TARGET_DIR%\Aaditech-Agent.ps1" >nul
copy /y "%SCRIPT_DIR%agent.json" "%TARGET_DIR%\agent.json" >nul

if exist "%SCRIPT_DIR%ca.crt" (
    echo [*] Registering Enterprise SSL Root Certificate...
    certutil -addstore -f "ROOT" "%SCRIPT_DIR%ca.crt" >nul 2>&1
)

:: 3. Configure File Security Permissions
icacls "%TARGET_DIR%" /inheritance:r /grant:r SYSTEM:(OI)(CI)F Administrators:(OI)(CI)F "NETWORK SERVICE":(OI)(CI)M /C >nul 2>&1

:: 4. Register Persistent Windows Scheduled Task
echo [*] Registering Windows Scheduled Task 'AaditechAgent'...
schtasks /delete /tn "AaditechAgent" /f >nul 2>&1

schtasks /create /tn "AaditechAgent" /sc minute /mo 15 /ru "NT AUTHORITY\SYSTEM" /rp "" /f /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%TARGET_DIR%\Aaditech-Agent.ps1\" -Once" >nul 2>&1

if !errorLevel! equ 0 (
    echo [OK] Scheduled task registered to run every 15 minutes as SYSTEM.
) else (
    echo [WARNING] Failed to register task with SYSTEM, falling back to current admin user...
    schtasks /create /tn "AaditechAgent" /sc minute /mo 15 /f /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%TARGET_DIR%\Aaditech-Agent.ps1\" -Once" >nul 2>&1
)

:: 5. Execute Immediate First Telemetry Check-in
echo [*] Executing immediate initial check-in...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET_DIR%\Aaditech-Agent.ps1" -Once

echo.
echo ============================================================================
echo [SUCCESS] Aaditech Agent installed successfully!
echo The machine is now actively reporting to your management portal.
echo ============================================================================
echo.
timeout /t 5
exit /b 0
