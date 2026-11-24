@echo off
:: RETIRED LEGACY BOOTSTRAP -- NEVER EXECUTES AN AGENT AS SYSTEM.
:: This former installer copied unchecked PowerShell from a writable bundle
:: and installed a persistent SYSTEM task with ExecutionPolicy Bypass.
:: It is intentionally disabled in all Windows environments until the
:: independent publisher-signed MSI release workflow has been accepted.
:: Never import bundled/self-signed roots into LocalMachine\ROOT automatically.
echo [BLOCKED] Legacy unchecked PowerShell agent installer is permanently disabled.
echo Use independently verified, publisher-signed IT-Toolkit Agent MSI and
echo approved installer scripts from an authenticated release owner.
echo No files, registry settings, tasks, CA certificates or credentials were modified.
exit /b 3
