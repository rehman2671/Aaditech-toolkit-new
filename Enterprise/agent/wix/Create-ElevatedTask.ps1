# Deprecated compatibility stub, deliberately never shipped in new MSIs.
# Security note: the previous helper created a SYSTEM task triggerable by
# NETWORK SERVICE and trusted unprivileged elevated-job.json in ProgramData.
# That flow cannot securely authorize a privileged operation and is disabled.
[CmdletBinding()]
param([string]$AgentExe)
throw 'SECURITY_BLOCK: ITToolkitAgentElevated is disabled. Deploy upgrades with an authorized administrator-managed Windows mechanism.'
