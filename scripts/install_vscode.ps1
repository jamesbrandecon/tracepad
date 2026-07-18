param([switch]$BuildOnly)

$ErrorActionPreference = "Stop"
$Arguments = @("$PSScriptRoot\install_vscode.py")
if ($BuildOnly) { $Arguments += "--build-only" }

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

Write-Error "Tracepad's VS Code installer requires Python 3.9 or newer."
exit 1
