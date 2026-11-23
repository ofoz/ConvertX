<#
.SYNOPSIS
Install confirmed Chocolatey dependencies, or report missing Windows commands.
.EXAMPLE
powershell -NoProfile -File .\scripts\install-windows-dependencies.ps1 -CheckOnly
.EXAMPLE
powershell -NoProfile -File .\scripts\install-windows-dependencies.ps1 -PackageTimeoutSeconds 600
.NOTES
Installation requires an already elevated terminal; this script never bypasses UAC
or self-elevates. Exit codes: 0 = commands found and no failed installs; 1 = missing,
failed, timed out or setup error; 3010 = reboot required with all commands found.
CheckOnly makes no installs or log files and requires no elevation.
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [ValidateRange(30, 3600)][int]$PackageTimeoutSeconds = 600,
  [string]$LogDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
$script:sessionLog = $null

function Write-InstallLog {
  param([string]$Message)
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  if ($script:sessionLog) { Add-Content -LiteralPath $script:sessionLog -Value $line -Encoding UTF8 }
}

function Invoke-DependencyInstall {
  param([string]$Chocolatey, [string]$Package, [string]$Directory, [int]$TimeoutSeconds)

  $stdout = Join-Path $Directory "$Package.stdout.log"
  $stderr = Join-Path $Directory "$Package.stderr.log"
  $nativeLog = Join-Path $Directory "$Package.chocolatey.log"
  $process = $null
  $timer = [Diagnostics.Stopwatch]::StartNew()
  try {
    # The outer timeout also bounds downloads/bootstrap code outside choco's timer.
    $arguments = @('install', $Package, '-y', '--no-progress', '--use-package-exit-codes',
      "--execution-timeout=$TimeoutSeconds", "--log-file=`"$nativeLog`"")
    $process = Start-Process -FilePath $Chocolatey -ArgumentList $arguments -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Cache the native handle before waiting. Windows PowerShell can otherwise
    # discard ExitCode after a fast process exits (Refresh alone is insufficient).
    $null = $process.Handle
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      Write-InstallLog "TIMEOUT $Package after $TimeoutSeconds seconds; terminating the Chocolatey process tree."
      $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
      $killer = Start-Process -FilePath $taskkill -ArgumentList @('/PID', $process.Id, '/T', '/F') `
        -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $Directory "$Package.terminate.log") `
        -RedirectStandardError (Join-Path $Directory "$Package.terminate.stderr.log")
      if (-not $killer.WaitForExit(10000)) { $killer.Kill() }
      if (-not $process.WaitForExit(5000)) { $process.Kill() }
      return [pscustomobject]@{ Package = $Package; Status = 'TimedOut'; ExitCode = 124; Seconds = [int]$timer.Elapsed.TotalSeconds }
    }
    $process.Refresh()
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) { throw 'Chocolatey terminated without an observable exit code.' }
    $status = if ($exitCode -eq 0) { 'Succeeded' } elseif ($exitCode -in @(1641, 3010)) { 'RebootRequired' } else { 'Failed' }
    return [pscustomobject]@{ Package = $Package; Status = $status; ExitCode = $exitCode; Seconds = [int]$timer.Elapsed.TotalSeconds }
  } catch {
    Write-InstallLog "ERROR $Package`: $($_.Exception.Message)"
    if ($process -and -not $process.HasExited) {
      Write-InstallLog "WARNING $Package may still have installer descendants; inspect its logs before retrying."
      $process.Kill()
    }
    return [pscustomobject]@{ Package = $Package; Status = 'Failed'; ExitCode = 1; Seconds = [int]$timer.Elapsed.TotalSeconds }
  } finally {
    $timer.Stop()
    if ($process) { $process.Dispose() }
  }
}

try {
  . (Join-Path $PSScriptRoot 'windows-common.ps1')
  $dependencies = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-dependencies.json') -Raw | ConvertFrom-Json
  Update-ConvertXPath $projectRoot
  $before = @(Get-ConvertXDependencyState $dependencies)
  Write-InstallLog '=== Discovery before installation ==='
  Write-ConvertXDependencyState $before
  if ($CheckOnly) {
    if (@($before | Where-Object { -not $_.Available }).Count -gt 0) { exit 1 }
    exit 0
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } finally {
    $identity.Dispose()
  }
  if (-not $isAdministrator) {
    throw 'Installation requires an elevated PowerShell terminal. Use Run as administrator (normal Windows UAC), or use -CheckOnly without elevation.'
  }
  $chocolatey = Get-ConvertXCommand 'choco'
  if (-not $chocolatey) { throw 'Chocolatey is not installed/on PATH. Install it separately or use -CheckOnly; no package manager is bootstrapped automatically.' }
  if (-not $LogDirectory) {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable; provide -LogDirectory.' }
    $runName = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([Guid]::NewGuid().ToString('N').Substring(0, 8))
    $LogDirectory = Join-Path $env:LOCALAPPDATA "ConvertX\logs\dependencies-$runName"
  }
  $null = New-Item -ItemType Directory -Path $LogDirectory -Force
  $LogDirectory = (Resolve-Path -LiteralPath $LogDirectory).Path
  $script:sessionLog = Join-Path $LogDirectory 'session.log'
  Write-InstallLog "=== Install confirmed packages; logs: $LogDirectory ==="

  $results = @()
  $stopQueue = $false
  foreach ($item in $before) {
    if (-not $item.Package) {
      Write-InstallLog "MANUAL $($item.Name): no unverified Chocolatey package will be attempted."
      continue
    }
    if ($item.Available) {
      $result = [pscustomobject]@{ Package = $item.Package; Status = 'AlreadyAvailable'; ExitCode = $null; Seconds = 0 }
    } elseif ($stopQueue) {
      $result = [pscustomobject]@{ Package = $item.Package; Status = 'NotAttempted'; ExitCode = $null; Seconds = 0 }
    } else {
      Write-InstallLog "--- BEGIN $($item.Package) (timeout ${PackageTimeoutSeconds}s) ---"
      $result = Invoke-DependencyInstall $chocolatey $item.Package $LogDirectory $PackageTimeoutSeconds
      # A normal failure does not block independent packages. Stop only if a
      # package reports a reboot, since continuing may depend on pending changes.
      if ($result.Status -eq 'RebootRequired') { $stopQueue = $true }
    }
    $results += $result
    $codeLabel = if ($null -eq $result.ExitCode) { 'not run' } else { [string]$result.ExitCode }
    Write-InstallLog "--- END $($result.Package): $($result.Status), exit=$codeLabel, seconds=$($result.Seconds) ---"
  }

  Write-InstallLog '=== Refresh PATH and verify actual commands ==='
  Update-ConvertXPath $projectRoot
  $after = @(Get-ConvertXDependencyState $dependencies)
  Write-ConvertXDependencyState $after
  $missing = @($after | Where-Object { -not $_.Available })
  $failed = @($results | Where-Object { $_.Status -in @('Failed', 'TimedOut', 'NotAttempted') })
  $reboot = @($results | Where-Object { $_.Status -eq 'RebootRequired' }).Count -gt 0
  $exitCode = if ($missing.Count -gt 0 -or $failed.Count -gt 0) { 1 } elseif ($reboot) { 3010 } else { 0 }
  $summary = [ordered]@{
    CheckedAt = (Get-Date).ToString('o')
    ExitCode = $exitCode
    RebootRequired = $reboot
    Packages = $results
    Dependencies = $after
    MissingCommands = @($missing | ForEach-Object { $_.Missing })
  }
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $LogDirectory 'summary.json') -Encoding UTF8
  Write-InstallLog '=== Final package results ==='
  foreach ($result in $results) { Write-InstallLog "$($result.Package): $($result.Status), exit=$($result.ExitCode)" }
  if ($reboot) { Write-InstallLog 'A package requested a reboot. Reboot and rerun -CheckOnly before relying on it.' }
  Write-InstallLog "Finished checks: missing groups=$($missing.Count); failed/skipped installs=$($failed.Count); exit=$exitCode. Summary: $(Join-Path $LogDirectory 'summary.json')"
  exit $exitCode
} catch {
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
}
