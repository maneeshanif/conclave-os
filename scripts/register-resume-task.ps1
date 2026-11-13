<#
.SYNOPSIS
  Creates (or with -Remove, deletes) the Windows Task Scheduler task that runs scripts/resume-autopilot.ps1 every 30 minutes.

.DESCRIPTION
  This script is NOT run by the build. You run it yourself, once, when you want the autopilot to resume on its own.
  The task runs as you, only while you are logged on, never in parallel with itself, and catches up after the laptop wakes.
  Remove it with:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-resume-task.ps1 -Remove
#>
[CmdletBinding()]
param(
  [switch]$Remove,
  [int]$EveryMinutes = 30,
  [string]$TaskName = 'ConclaveAutopilotResume'
)

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed the task $TaskName."
  } else {
    Write-Output "There is no task called $TaskName."
  }
  return
}

$script = Join-Path $PSScriptRoot 'resume-autopilot.ps1'
if (-not (Test-Path $script)) { throw "Cannot find $script" }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script) -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Resumes the Conclave OS autopilot build when nothing is working on it.' | Out-Null
Write-Output "Created the task $TaskName: every $EveryMinutes minutes, running ${script}. Log: DATA_DIR\logs\resume.log"
