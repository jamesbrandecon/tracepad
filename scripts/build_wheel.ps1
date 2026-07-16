param([string]$Venv = $env:TRACEPAD_VENV)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
if (-not $Venv) { $Venv = Join-Path $RootDir ".venv" }
if (-not [System.IO.Path]::IsPathRooted($Venv)) { $Venv = Join-Path $RootDir $Venv }
$Python = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Error "Run .\scripts\install.ps1 before building a wheel."
    exit 1
}
& $Python "$PSScriptRoot\build_wheel.py" --venv $Venv
exit $LASTEXITCODE
