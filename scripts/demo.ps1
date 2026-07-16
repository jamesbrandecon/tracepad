param(
    [string]$Venv = $env:TRACEPAD_VENV,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $Venv) { $Venv = Join-Path $RootDir ".venv" }
if (-not [System.IO.Path]::IsPathRooted($Venv)) { $Venv = Join-Path $RootDir $Venv }
$Python = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Error "Tracepad is not installed. Run .\scripts\install.ps1 first."
    exit 1
}
$Arguments = @("$PSScriptRoot\demo.py", "--venv", $Venv)
if ($DryRun) { $Arguments += "--dry-run" }
& $Python @Arguments
exit $LASTEXITCODE
