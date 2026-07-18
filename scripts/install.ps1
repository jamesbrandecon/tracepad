param(
    [string]$Venv = $env:TRACEPAD_VENV,
    [switch]$Minimal
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$Arguments = @("$PSScriptRoot\install.py")
if ($Venv) { $Arguments += @("--venv", $Venv) }
if ($Minimal) { $Arguments += "--minimal" }

if ($env:PYTHON) {
    & $env:PYTHON @Arguments
    exit $LASTEXITCODE
}
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 @Arguments
    exit $LASTEXITCODE
}
if (Get-Command python -ErrorAction SilentlyContinue) {
    & python @Arguments
    exit $LASTEXITCODE
}

Write-Error "Tracepad requires Python 3.9 or newer. Install Python or set PYTHON."
exit 1
