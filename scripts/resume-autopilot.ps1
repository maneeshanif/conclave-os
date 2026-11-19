<#
.SYNOPSIS
  Resumes the autopilot build when nothing is working on it (Windows PowerShell 5.1 or later).

.DESCRIPTION
  Meant to be run by Task Scheduler every 30 minutes (see scripts/register-resume-task.ps1). Each run:
    1. skips if a usage limit was reported and its reset time has not passed;
    2. skips if a Claude run started by this script is still going;
    3. skips if docs/PROGRESS.md has a "Working now" claim younger than 45 minutes (an interactive session is busy);
    4. skips unless the repo is on the dev branch;
    5. otherwise runs Claude Code headless in the repo with the standard resume prompt, in the same auto permission mode as
       an interactive session. It never uses --dangerously-skip-permissions: anything that would need a person's answer is
       denied (--permission-prompts none).
  If the run ends because of a usage limit, the reset time is written to DATA_DIR/logs/resume-limit.txt and later checks skip
  until then. Every check is logged to DATA_DIR/logs/resume.log. Nothing is registered or changed on the machine except those logs.

.PARAMETER DryRun
  Log what would happen and print the command, but do not start Claude.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = $(if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }),
  [string]$DataDir = $(if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $HOME '.conclave-os' }),
  [int]$ClaimMinutes = 45,
  [switch]$DryRun
)

$ResumePrompt = @'
Autopilot. Read CLAUDE.md, docs/AUTOPILOT.md, docs/QUESTIONS.md (the Answers sections), docs/PROGRESS.md and docs/BUILD.md. Continue on the dev branch from the next unticked task in docs/BUILD.md, task by task, test first, commit and push after each task, tag slice-<n>-done when a slice's test passes, then go straight on to the next slice (draft its task list in docs/BUILD.md first). Claim each task in docs/PROGRESS.md before starting. Do not end your turn between tasks: keep going until a real stop (a usage limit, or something only I can do). Park anything that needs me in docs/NEEDS-YOU.md. Never merge to master, force push, create accounts, or enter or ask for my passwords or keys. Real sending transports stay off.
'@

# ---- The logic, as functions the tests can load without running anything ----

function Write-ResumeLog([string]$LogDir, [string]$Message, [datetime]$At = (Get-Date)) {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Add-Content -Path (Join-Path $LogDir 'resume.log') -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f $At, $Message) -Encoding UTF8
}

# Minutes since the "Working now" claim in PROGRESS.md was written, or $null if there is no claim with a time on it.
function Get-ClaimAgeMinutes([string]$ProgressPath, [datetime]$Now = (Get-Date)) {
  if (-not (Test-Path $ProgressPath)) { return $null }
  $line = Get-Content -Path $ProgressPath -Encoding UTF8 | Where-Object { $_ -match '^\s*-\s*\*\*Working now:\*\*' } | Select-Object -First 1
  if (-not $line) { return $null }
  $m = [regex]::Matches($line, '\d{4}-\d{2}-\d{2} \d{2}:\d{2}')
  if ($m.Count -eq 0) { return $null }
  $when = [datetime]::ParseExact($m[$m.Count - 1].Value, 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
  return [math]::Floor(($Now - $when).TotalMinutes)
}

# A claim is live while it is younger than the limit. A claim dated in the future (a clock set wrong) counts as live too.
function Test-ClaimLive($AgeMinutes, [int]$Limit = 45) {
  if ($null -eq $AgeMinutes) { return $false }
  return ($AgeMinutes -lt $Limit)
}

# When a usage limit says it lifts: a Unix time after a bar, or "resets 5pm" (the next 5pm), else five hours on.
function Get-LimitResetTime([string]$Text, [datetime]$Now = (Get-Date)) {
  $m = [regex]::Match($Text, '\|\s*(\d{10,13})\b')
  if ($m.Success) {
    $n = [int64]$m.Groups[1].Value
    if ($m.Groups[1].Value.Length -ge 13) { $n = [math]::Floor($n / 1000) }
    $t = [DateTimeOffset]::FromUnixTimeSeconds($n).LocalDateTime
    if ($t -gt $Now -and $t -lt $Now.AddDays(8)) { return $t }
  }
  $m = [regex]::Match($Text, 'resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)', 'IgnoreCase')
  if ($m.Success) {
    $h = [int]$m.Groups[1].Value % 12
    if ($m.Groups[3].Value.ToLower() -eq 'pm') { $h += 12 }
    $min = if ($m.Groups[2].Success) { [int]$m.Groups[2].Value } else { 0 }
    $t = $Now.Date.AddHours($h).AddMinutes($min)
    if ($t -le $Now) { $t = $t.AddDays(1) }
    return $t
  }
  return $Now.AddHours(5)
}

function Test-UsageLimitText([string]$Text) {
  return ($Text -match '(?i)usage limit|hit your limit|limit reached|out of credits|credit balance|quota')
}

# The reset time saved by an earlier run, or $null when there is none or it has passed.
function Get-ActiveLimit([string]$LimitFile, [datetime]$Now = (Get-Date)) {
  if (-not (Test-Path $LimitFile)) { return $null }
  try { $t = [datetime]::Parse((Get-Content -Path $LimitFile -Raw).Trim(), [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind').ToLocalTime() } catch { return $null }
  if ($t -gt $Now) { return $t }
  return $null
}

# Is the Claude run this script started still alive? The pid file holds "<pid> <start time>" so a reused pid is not mistaken for it.
function Test-OwnRunAlive([string]$PidFile) {
  if (-not (Test-Path $PidFile)) { return $false }
  $parts = (Get-Content -Path $PidFile -Raw).Trim() -split '\s+', 2
  if ($parts.Count -lt 2) { return $false }
  $p = Get-Process -Id ([int]$parts[0]) -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  try { return ($p.StartTime.ToUniversalTime().ToString('o') -eq $parts[1]) } catch { return $false }
}

# What to do now, and why. One place, so every check logs the same way.
function Get-ResumeDecision([string]$RepoRoot, [string]$DataDir, [int]$ClaimMinutes, [datetime]$Now = (Get-Date), [string]$Branch = '') {
  $logs = Join-Path $DataDir 'logs'
  $limit = Get-ActiveLimit (Join-Path $logs 'resume-limit.txt') $Now
  if ($limit) { return @{ Run = $false; Why = ('usage limit until {0:yyyy-MM-dd HH:mm}' -f $limit) } }
  if (Test-OwnRunAlive (Join-Path $logs 'resume.pid')) { return @{ Run = $false; Why = 'a run started by this script is still going' } }
  $age = Get-ClaimAgeMinutes (Join-Path $RepoRoot 'docs/PROGRESS.md') $Now
  if (Test-ClaimLive $age $ClaimMinutes) { return @{ Run = $false; Why = "someone claimed a task $age minutes ago (under $ClaimMinutes)" } }
  if ($Branch -and $Branch -ne 'dev') { return @{ Run = $false; Why = "the repo is on '$Branch', not dev" } }
  $ageText = if ($null -eq $age) { 'no claim' } else { "last claim $age minutes old" }
  return @{ Run = $true; Why = "nothing is working on it ($ageText)" }
}

# ---- The run, only when the script is executed, not when it is loaded for its functions ----

if ($MyInvocation.InvocationName -eq '.') { return }

$logs = Join-Path $DataDir 'logs'
$now = Get-Date
$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
$decision = Get-ResumeDecision $RepoRoot $DataDir $ClaimMinutes $now $branch
if (-not $decision.Run) {
  Write-ResumeLog $logs "skip: $($decision.Why)" $now
  exit 0
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-ResumeLog $logs 'skip: the claude command is not on PATH for this task' $now
  exit 1
}

$stamp = $now.ToString('yyyyMMdd-HHmmss')
$promptFile = Join-Path $logs "resume-$stamp.prompt.txt"
$outFile = Join-Path $logs "resume-$stamp.out.txt"
$errFile = Join-Path $logs "resume-$stamp.err.txt"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Set-Content -Path $promptFile -Value $ResumePrompt -Encoding UTF8

# -p runs headless and reads the prompt from stdin. --permission-mode auto is the same safety classifier as an interactive
# auto session; --permission-prompts none means a prompt nobody can answer is denied, never waved through.
$cliArgs = @('-p', '--permission-mode', 'auto', '--permission-prompts', 'none', '--output-format', 'text')
if ($DryRun) {
  Write-ResumeLog $logs "dry run: would start: $($claude.Source) $($cliArgs -join ' ') < $promptFile (in $RepoRoot)" $now
  Write-Output "$($claude.Source) $($cliArgs -join ' ') < $promptFile"
  exit 0
}

Write-ResumeLog $logs "start: $($decision.Why); output in $outFile" $now
$proc = Start-Process -FilePath $claude.Source -ArgumentList $cliArgs -WorkingDirectory $RepoRoot -RedirectStandardInput $promptFile -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru -WindowStyle Hidden
Set-Content -Path (Join-Path $logs 'resume.pid') -Value ('{0} {1}' -f $proc.Id, $proc.StartTime.ToUniversalTime().ToString('o')) -Encoding ASCII
$proc.WaitForExit()
Remove-Item -Path (Join-Path $logs 'resume.pid') -ErrorAction SilentlyContinue

$text = ''
foreach ($f in @($outFile, $errFile)) { if (Test-Path $f) { $text += (Get-Content -Path $f -Raw -ErrorAction SilentlyContinue) + "`n" } }
if ($proc.ExitCode -ne 0 -and (Test-UsageLimitText $text)) {
  $until = Get-LimitResetTime $text (Get-Date)
  Set-Content -Path (Join-Path $logs 'resume-limit.txt') -Value $until.ToUniversalTime().ToString('o') -Encoding ASCII
  Write-ResumeLog $logs ('end: usage limit; checks skip until {0:yyyy-MM-dd HH:mm}' -f $until)
} else {
  Write-ResumeLog $logs "end: exit code $($proc.ExitCode)"
}
exit 0
