# Registers zk-sync-agent as a Windows Scheduled Task (runs at logon, restarts on failure).
# Run once in an elevated PowerShell:  .\install-windows-service.ps1

$ErrorActionPreference = "Stop"
$taskName = "GIALCO-ZK-Sync-Agent"
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $agentDir "sync.js"

if (-not (Test-Path (Join-Path $agentDir ".env"))) {
  Write-Error "Missing .env — copy env.example to .env and set SYNC_SECRET / CLOUD_API_URL first."
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $agentDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Poll ZKTeco K50 Pro and sync attendance to GIALCO RH" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "OK — task '$taskName' installed and started."
Write-Host "Remove later with: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
