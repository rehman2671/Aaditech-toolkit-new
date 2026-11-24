# Exercise real isolated worker functions without OS actions or network.
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\agent\Agent-Collect.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
if($errors.Count) { throw ($errors | Out-String) }
foreach($name in @('ConvertTo-CommandUuid','Get-ExecutedCommand','Try-ClaimVerifiedCommand','ConvertTo-CommandResult','Record-ExecutedCommand','Send-CommandResult','Invoke-VerifiedCommandOnce')) {
    $nodes=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
    if($nodes.Count -ne 1) { throw "Missing function $name" }
    . ([scriptblock]::Create($nodes[0].Extent.Text))
}
$uuid='6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e'
$QueueDb='fixture-only'
$script:Row=$null; $script:Executed=0; $script:Queries=0; $script:Posts=0
function Invoke-SQLite {
    param($Query,$DatabasePath,[switch]$AsJson)
    $script:Queries++
    if($Query -notmatch [regex]::Escape("'$uuid'")) { throw 'Wrong or unquoted UUID' }
    if($Query.StartsWith('INSERT OR IGNORE')) {
        if($script:Row) { return '0' }
        $script:Row=@{status='claimed';output='';exit_code=0}
        return '1'
    }
    if($Query.StartsWith('SELECT command_id')) { return (ConvertTo-Json -InputObject @($script:Row) -Compress) }
    if($Query.StartsWith('UPDATE executed_commands_v2') -and $script:Row.status -eq 'claimed') {
        $script:Row=@{status='completed';output='ok';exit_code=0}
        return '1'
    }
    throw 'Unexpected SQL'
}
function Resolve-VerifiedAgentCommand { param($Config,$Cmd) if($Cmd.valid) { return $Cmd } }
function Invoke-RemoteCommand { param($Config,$Cmd) $script:Executed++; return @{status='completed';output='ok';exit_code=0} }
function ConvertTo-SanitizedText { param($Text) return $Text }
function Get-CommandsApiRoot { 'https://example.test' }
function Get-RestCertificate { param($Config) $null }
function Get-AgentToken { param($Config) 'itk_dev_test' }
function Write-AgentLog { param($Message) }
function Invoke-RestMethod {
    param($Uri,$Method,$Headers,$ContentType,$Body,$Certificate)
    if($Uri -ne "https://example.test/api/commands/$uuid/result") { throw 'Wrong result URI' }
    $script:Body=$Body | ConvertFrom-Json
    $script:Posts++
}
Invoke-VerifiedCommandOnce -Config @{} -Cmd @{id='invalid-id';valid=$false}
if($script:Queries -or $script:Executed -or $script:Posts) { throw 'Unsigned command reached database or network' }
Invoke-VerifiedCommandOnce -Config @{} -Cmd @{id=$uuid;valid=$true}
Invoke-VerifiedCommandOnce -Config @{} -Cmd @{id=$uuid;valid=$true}
if($script:Executed -ne 1 -or $script:Posts -ne 2) { throw 'Duplicate ran twice or did not resend result' }
if($script:Body.status -ne 'completed' -or $script:Body.exit_code -ne 0 -or $script:Body.output -ne 'ok' -or @($script:Body.PSObject.Properties.Name).Count -ne 3) { throw 'Wrong strict result body' }
$script:Row=@{status='claimed';output='';exit_code=0}
Invoke-VerifiedCommandOnce -Config @{} -Cmd @{id=$uuid;valid=$true}
if($script:Executed -ne 1 -or $script:Posts -ne 2) { throw 'Uncertain claim was rerun or falsely reported' }
$b=ConvertTo-CommandResult @{status='completed';output=('x'*40000);exit_code=9}
if($b.status -ne 'failed' -or $b.output.Length -ne 32768) { throw 'Unbounded or false result' }
Write-Host '[PASS] UUID claim, duplicate/uncertain result handling, strict API body.'
