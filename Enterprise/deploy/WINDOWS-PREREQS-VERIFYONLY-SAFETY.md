# Windows prerequisite inventory `-VerifyOnly` safety contract

**Status:** Code-only hardening of a legacy Windows prerequisite script; **not** approval of Windows Server/Docker Desktop runtime support or production setup.

Previously `Enterprise/deploy/Install-Prereqs.ps1 -VerifyOnly` could call `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force` when the original effective policy was Restricted/AllSigned. That **weakened a security policy while claiming to install nothing**. It also refused to perform a read-only check when not elevated.

Now `-VerifyOnly` never invokes `Set-ExecutionPolicy`, `winget install`, `Enable-WindowsOptionalFeature`, `Install-Module`, or `dotnet tool install`. The Winget mutating helper explicitly rejects VerifyOnly as defense in depth. The non-admin inventory is allowed, but WSL state is reported **NOT VERIFIED**, and readiness returns exit **3** until privileged/required conditions can be independently verified. Restricted/AllSigned effective execution policy is **never downgraded**, even in install mode; installation stops before mutating if IT approval would be required. Exit 0 means only that the tool inventory passed its limited checks, **not** that a supported, offline, signed or production LAN server exists.

Run **read-only inventory** on Windows only:
```powershell
pwsh -NoProfile -File ./Enterprise/deploy/Install-Prereqs.ps1 -VerifyOnly -SkipDocker
```
The script only checks local prerequisites. It does not download, run installer actions, create credentials, format storage, change registry/policy, or configure network trust in VerifyOnly. The installer path **without** VerifyOnly may download/install prerequisites and change Windows optional features; it is not an approved first-run LAN server installer. The older Docker Desktop/WSL2 instructions are **not** proof of a Windows Server supported runtime model.

Validation: native Windows PowerShell 7 script `Enterprise/tests/Test-PrereqsVerifyOnly.ps1` invokes the actual `-VerifyOnly -SkipDocker` command as a child and compares complete scoped execution policy before/after. CI also parses all PowerShell files. Vitest source contracts reject policy-downgrade code and VerifyOnly guard regression.

Owner decisions [#79](https://github.com/rehman2671/Aaditech-toolkit-new/issues/79) and full disconnected-LAN installer [#80](https://github.com/rehman2671/Aaditech-toolkit-new/issues/80) remain outstanding. Release protections [#62](https://github.com/rehman2671/Aaditech-toolkit-new/issues/62) remain pending. No operator acceptance is implied by this PR.
