# Shared by the Windows installer and launcher. Does not change persistent PATH.
function Get-ConvertXCommand {
  param([Parameter(Mandatory = $true)][string]$Name, [switch]$AllowShellWrapper)

  $commands = @(Get-Command $Name -CommandType Application -All -ErrorAction SilentlyContinue)
  foreach ($command in $commands) {
    # Converter execFile calls need a native executable on Windows. The Bun
    # launcher may use an npm .cmd shim because PowerShell invokes that itself.
    if (-not $AllowShellWrapper -and [IO.Path]::GetExtension($command.Source) -notin @('.exe', '.com')) { continue }
    # App Execution Aliases may open the Store instead of running Python.
    if ($Name -in @('python', 'python3') -and $command.Source -like '*\Microsoft\WindowsApps\*') {
      continue
    }
    if (Test-Path -LiteralPath $command.Source -PathType Leaf) {
      return $command.Source
    }
  }
  return $null
}

function Update-ConvertXPath {
  param([Parameter(Mandatory = $true)][string]$ProjectRoot)

  $paths = New-Object 'System.Collections.Generic.List[string]'
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $candidates = @($env:Path, [Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) {
      $candidates += Join-Path $base 'LibreOffice\program'
      if ($base -eq $env:LOCALAPPDATA) {
        $candidates += Join-Path $base 'Programs\LibreOffice\program'
      }
    }
  }

  $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-dependencies.json') -Raw | ConvertFrom-Json
  $targetNames = @($manifest | ForEach-Object { $_.commands }) + @('bun')
  $toolRoots = @(Join-Path $ProjectRoot '.local\tools')
  if ($env:LOCALAPPDATA) { $toolRoots += Join-Path $env:LOCALAPPDATA 'ConvertX\tools' }
  if ($env:USERPROFILE) {
    $toolRoots += Join-Path $env:USERPROFILE '.local\tools'
    $candidates += Join-Path $env:USERPROFILE '.local\bin'
  }
  if ($env:PIPX_BIN_DIR) { $candidates += $env:PIPX_BIN_DIR }
  foreach ($toolRoot in $toolRoots) {
    if (Test-Path -LiteralPath $toolRoot -PathType Container) {
      # Scan each tools tree once, then add only directories with target commands
      # (including nested Calibre2/bin folders), not every dependency DLL folder.
      $executables = @(Get-ChildItem -LiteralPath $toolRoot -File -Recurse -ErrorAction Stop |
        Where-Object {
          $_.Extension -in @('.exe', '.com', '.cmd', '.bat') -and
          $_.BaseName -in $targetNames -and
          $_.FullName.Substring($toolRoot.Length) -notmatch '[\\/](?:packages|downloads|\.?cache|staging|verification)[\\/]'
        })
      $candidates += @($executables | Select-Object -ExpandProperty DirectoryName -Unique)
    }
  }

  foreach ($candidate in $candidates) {
    foreach ($part in ($candidate -split ';')) {
      $path = [Environment]::ExpandEnvironmentVariables($part.Trim().Trim('"'))
      if ($path -and (Test-Path -LiteralPath $path -PathType Container) -and $seen.Add($path.TrimEnd('\'))) {
        $paths.Add($path)
      }
    }
  }
  $env:Path = $paths -join ';'
}

function Get-ConvertXDependencyState {
  param([Parameter(Mandatory = $true)][object[]]$Dependencies)

  foreach ($dependency in $Dependencies) {
    $found = @()
    $missing = @()
    foreach ($command in $dependency.commands) {
      $source = Get-ConvertXCommand $command
      if ($source) {
        $found += [pscustomobject]@{ Command = $command; Path = $source }
      } else {
        $missing += $command
      }
    }
    $anyCommand = $dependency.PSObject.Properties['anyCommand'] -and $dependency.anyCommand
    $available = if ($anyCommand) { $found.Count -gt 0 } else { $missing.Count -eq 0 }
    [pscustomobject]@{
      Name = $dependency.name
      Package = $dependency.package
      Available = $available
      Found = $found
      Missing = $(if ($available) { @() } elseif ($anyCommand) { @($dependency.commands -join ' OR ') } else { $missing })
      Manual = $(if ($dependency.PSObject.Properties['manual']) { $dependency.manual } else { $null })
    }
  }
}

function Write-ConvertXDependencyState {
  param([Parameter(Mandatory = $true)][object[]]$State)

  foreach ($item in $State) {
    foreach ($command in $item.Found) {
      Write-Host "[FOUND] $($command.Command) => $($command.Path)"
    }
    if (-not $item.Available) {
      Write-Host "[MISSING] $($item.Name): $($item.Missing -join ', ')" -ForegroundColor Yellow
      if ($item.Manual) { Write-Host "  MANUAL: $($item.Manual)" }
    }
  }
  $missing = @($State | Where-Object { -not $_.Available })
  Write-Host "Command discovery: $($State.Count - $missing.Count)/$($State.Count) dependency groups available."
  if ($missing.Count -gt 0) {
    Write-Host ('Missing commands: ' + (($missing | ForEach-Object { $_.Missing }) -join ', ')) -ForegroundColor Yellow
  }
  Write-Host 'Discovery checks executable presence, not successful conversion or all optional codecs/fonts.'
}
