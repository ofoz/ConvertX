<#
.SYNOPSIS
Run ConvertX development mode with refreshed Windows converter paths.
.EXAMPLE
powershell -NoProfile -File .\scripts\start-windows.ps1 -CheckOnly
.EXAMPLE
powershell -NoProfile -File .\scripts\start-windows.ps1
.NOTES
Run bun install separately first. No dependencies are installed here. CheckOnly
checks readiness without starting Bun, changing persistent configuration or writing
secrets. Missing converters make CheckOnly return 1; normal startup warns and
allows the installed subset. Existing environment and Bun .env settings win.
#>
[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-ProjectEnvironmentSetting {
  param([string]$Name)

  if ($null -ne [Environment]::GetEnvironmentVariable($Name, 'Process')) { return $true }
  $mode = if ($env:NODE_ENV) { $env:NODE_ENV } else { 'development' }
  # Bun loads these files itself. Only detect explicit settings; do not copy or
  # reinterpret dotenv values, expand secrets, or replace user configuration.
  $files = @('.env', ".env.$mode")
  if ($mode -ne 'test') { $files += '.env.local' }
  foreach ($file in $files) {
    $path = Join-Path $projectRoot $file
    if ((Test-Path -LiteralPath $path -PathType Leaf) -and
        (Select-String -LiteralPath $path -Pattern "^\s*(?:export\s+)?$([regex]::Escape($Name))\s*=" -Quiet)) {
      return $true
    }
  }
  return $false
}

function Get-LocalDevelopmentSecret {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force
    $bytes = New-Object byte[] 48
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $secret = [Convert]::ToBase64String($bytes)
    $stream = $null
    try {
      # CreateNew prevents simultaneous launchers overwriting each other's key.
      $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $encoded = [Text.Encoding]::UTF8.GetBytes($secret)
      $stream.Write($encoded, 0, $encoded.Length)
    } catch [IO.IOException] {
      if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw }
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  }
  $value = [IO.File]::ReadAllText($Path).Trim()
  if ($value.Length -lt 32) {
    throw "Existing development key is empty/too short: $Path. It was not overwritten; repair it or set JWT_SECRET explicitly."
  }
  return $value
}

try {
  . (Join-Path $PSScriptRoot 'windows-common.ps1')
  Update-ConvertXPath $projectRoot
  $dependencies = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-dependencies.json') -Raw | ConvertFrom-Json
  $state = @(Get-ConvertXDependencyState $dependencies)
  Write-ConvertXDependencyState $state
  $bun = Get-ConvertXCommand 'bun' -AllowShellWrapper
  $hasModules = Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container
  if ($bun) { Write-Host "Bun: $bun" } else { Write-Warning 'Bun executable is missing from PATH.' }
  if (-not $hasModules) { Write-Warning 'node_modules is missing; run bun install separately before starting.' }

  $hasConfiguredSecret = Test-ProjectEnvironmentSetting 'JWT_SECRET'
  $secretPath = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'ConvertX\dev-jwt-secret' } else { $null }
  if ($hasConfiguredSecret) {
    Write-Host 'JWT_SECRET: using existing process environment or project dotenv configuration.'
  } elseif ($secretPath -and (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    if ([IO.File]::ReadAllText($secretPath).Trim().Length -lt 32) {
      throw "Existing development key is empty/too short: $secretPath. It was not overwritten; repair it or set JWT_SECRET explicitly."
    }
    Write-Host "JWT_SECRET: persistent local development key available at $secretPath (value hidden)."
  } elseif ($secretPath) {
    Write-Host "JWT_SECRET: a persistent local development key will be created at $secretPath on startup."
  } else {
    throw 'LOCALAPPDATA is unavailable. Set JWT_SECRET explicitly or provide it in the project dotenv configuration.'
  }
  Write-Host 'ACCOUNT_REGISTRATION, HTTP_ALLOWED and other application settings are inherited; project dotenv files remain managed by Bun.'

  if ($CheckOnly) {
    if (-not $bun -or -not $hasModules -or @($state | Where-Object { -not $_.Available }).Count -gt 0) { exit 1 }
    exit 0
  }
  if (-not $bun -or -not $hasModules) { throw 'Startup prerequisites are missing; see the messages above.' }
  if (-not $hasConfiguredSecret) { $env:JWT_SECRET = Get-LocalDevelopmentSecret $secretPath }
  if (@($state | Where-Object { -not $_.Available }).Count -gt 0) {
    Write-Warning 'Some converters are missing. Only conversions supported by the installed tools can work.'
  }

  Push-Location -LiteralPath $projectRoot
  try {
    Write-Host "Starting ConvertX development mode from $projectRoot"
    & $bun run dev
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  exit $exitCode
} catch {
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
}
