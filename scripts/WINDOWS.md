# Windows local development

From the project root, inspect the current environment without installing anything:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-dependencies.ps1 -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1 -CheckOnly
```

`-ExecutionPolicy Bypass` applies only to that PowerShell child process so these
unsigned local scripts can run; it does not elevate privileges or bypass UAC.
Omit it when your execution policy already allows local scripts. Organisation
Group Policy can still prevent execution.

To install missing, confirmed Chocolatey packages, open PowerShell with **Run as
administrator**, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-dependencies.ps1 -PackageTimeoutSeconds 600
```

The installer does not bootstrap Chocolatey or elevate itself. It skips commands
already found, gives each package a bounded timeout, and continues after ordinary
package failures. A reboot request stops the queue; rerun after reboot. Timed-out
Chocolatey process trees are terminated, but Windows Installer services can
outlive their parent: inspect the logs before retrying a timed-out installation.
Logs are split by package under `%LOCALAPPDATA%\ConvertX\logs\dependencies-*`,
including `session.log`, stdout/stderr logs and a machine-readable `summary.json`.
Use `-LogDirectory <path>` to choose another location.

The JSON manifest lists confirmed Chocolatey package IDs only. Entries with
`"package": null` require manual installation; the script will not guess a package
name or claim those dependencies were installed. Place native converter tools
under `%LOCALAPPDATA%\ConvertX\tools`, the project's `.local\tools`, or the user's
`.local\tools` (nested release/bin directories are supported). The launcher scans
each tools tree once and adds only directories containing target commands to the
process PATH, alongside existing process/system/user PATH, LibreOffice `program`,
and the user's `.local\bin`. Extracted package caches and directories named
`packages`, `downloads`, `cache`, `.cache`, `staging` or `verification` are excluded
from discovery so an incomplete staging executable cannot shadow the installed
runtime. PATH changes are not written to the registry.

After installing Bun and running `bun install` separately, start development:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

For a local HTTP preview, set the settings in that terminal before launching:

```powershell
$env:HTTP_ALLOWED = 'true'
$env:PORT = '3000'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

The launcher retains existing application environment settings, including
`JWT_SECRET`, `ACCOUNT_REGISTRATION` and `HTTP_ALLOWED`. Bun still loads project
`.env`, `.env.<NODE_ENV>` and `.env.local` files using its own rules. If no explicit
JWT setting is found in the process or those dotenv files, the launcher creates
and reuses a random local development key at
`%LOCALAPPDATA%\ConvertX\dev-jwt-secret`. It never prints the value or replaces an
existing key. Keep this local key private; removing it signs out existing sessions.
CheckOnly neither creates a key nor starts Bun. Custom `bun --env-file` options are
not supplied by this launcher; use the process environment or standard dotenv
files for overrides.

Exit codes: `0` means all listed command groups are discoverable and there were no
installation failures, `1` means missing commands or an error, and installer
`3010` means a reboot is required with all commands otherwise found. Original
per-package exit codes (including `1641`/`3010`) remain in the logs and summary.
`-CheckOnly` returns `1` while any converter/manual dependency is missing; this is
expected on a partial installation. Normal startup permits the installed subset
and warns about missing converters. Command discovery does not prove successful
conversion, codecs, TeX packages, Perl modules, or font availability.
