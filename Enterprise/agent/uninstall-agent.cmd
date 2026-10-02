@echo off
:: ============================================================================
:: Aaditech Enterprise Agent - Clean Uninstallation
:: ============================================================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Run as Administrator required.
    pause
    exit /b 1
)

echo [*] Removing Scheduled Task 'AaditechAgent'...
schtasks /delete /tn "AaditechAgent" /f >nul 2>&1

echo [*] Removing ProgramData files...
if exist "C:\ProgramData\AaditechAgent" (
    rmdir /s /q "C:\ProgramData\AaditechAgent" >nul 2>&1
)

echo [OK] Aaditech Agent has been cleanly removed from this machine.
pause
