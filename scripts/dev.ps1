[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int] $ApiPort = 8000,

    [Parameter()]
    [ValidateRange(1, 65535)]
    [int] $WebPort = 5173
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-RequiredCommand {
    param(
        [Parameter(Mandatory)]
        [string] $Name,

        [Parameter(Mandatory)]
        [string] $InstallHint
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "Required command '$Name' was not found. $InstallHint"
    }

    return $command.Source
}

function Assert-PortAvailable {
    param(
        [Parameter(Mandatory)]
        [int] $Port
    )

    $listener = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Loopback,
        $Port
    )

    try {
        $listener.Start()
    }
    catch {
        throw "Port $Port is already in use on 127.0.0.1. Choose another port with -ApiPort or -WebPort."
    }
    finally {
        $listener.Stop()
    }
}

function Stop-DevelopmentProcess {
    param(
        [Parameter(Mandatory)]
        [System.Diagnostics.Process] $Process
    )

    if ($Process.HasExited) {
        return
    }

    $taskkill = Get-Command "taskkill.exe" -ErrorAction SilentlyContinue
    if ($null -ne $taskkill) {
        & $taskkill.Source /PID $Process.Id /T /F 2>$null | Out-Null
        return
    }

    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
}

if ($ApiPort -eq $WebPort) {
    throw "The API and frontend must use different ports."
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendRoot = Join-Path $repositoryRoot "frontend"
$pyprojectPath = Join-Path $repositoryRoot "pyproject.toml"
$packageJsonPath = Join-Path $frontendRoot "package.json"

if (-not (Test-Path -LiteralPath $pyprojectPath -PathType Leaf)) {
    throw "Missing pyproject.toml at '$pyprojectPath'. Run this script from a complete repository checkout."
}

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw "Missing frontend/package.json at '$packageJsonPath'. Run this script from a complete repository checkout."
}

$python = Get-RequiredCommand -Name "python.exe" -InstallHint "Install Python 3.12 and activate the project's virtual environment."
$node = Get-RequiredCommand -Name "node.exe" -InstallHint "Install Node.js 22."
$pnpm = Get-RequiredCommand -Name "pnpm.cmd" -InstallHint "Install pnpm 10, for example with 'corepack enable'."

$pythonVersion = & $python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0 -or [version]$pythonVersion -lt [version]"3.12") {
    throw "Python 3.12 or newer is required; found '$pythonVersion'."
}

$nodeVersionText = (& $node --version).TrimStart("v")
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersionText -lt [version]"22.0") {
    throw "Node.js 22 or newer is required; found '$nodeVersionText'."
}

$pnpmVersionText = (& $pnpm --version).Trim()
if ($LASTEXITCODE -ne 0 -or [version]$pnpmVersionText -lt [version]"10.0") {
    throw "pnpm 10 or newer is required; found '$pnpmVersionText'."
}

& $python -c "import backend.app, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Backend dependencies are not installed. Run 'python -m pip install -e .[dev]' from '$repositoryRoot'."
}

if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot "node_modules") -PathType Container)) {
    throw "Frontend dependencies are not installed. Run 'pnpm install --frozen-lockfile' from '$frontendRoot'."
}

Assert-PortAvailable -Port $ApiPort
Assert-PortAvailable -Port $WebPort

# The API rejects browser requests from unexpected local origins. Development uses
# Vite on a separate loopback port, so authorize only the two selected loopback ports.
$env:COMPLIANCE_ALLOWED_ORIGINS = @(
    "http://127.0.0.1:$WebPort"
    "http://localhost:$WebPort"
    "http://127.0.0.1:$ApiPort"
    "http://localhost:$ApiPort"
) -join ","

$backendArguments = @(
    "-m", "uvicorn", "backend.app.main:app",
    "--reload",
    "--host", "127.0.0.1",
    "--port", $ApiPort.ToString()
)
$frontendArguments = @(
    "dev",
    "--host", "127.0.0.1",
    "--port", $WebPort.ToString(),
    "--strictPort"
)

$processes = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

try {
    Write-Host "Starting API at http://127.0.0.1:$ApiPort"
    $backend = Start-Process `
        -FilePath $python `
        -ArgumentList $backendArguments `
        -WorkingDirectory $repositoryRoot `
        -NoNewWindow `
        -PassThru
    $processes.Add($backend)

    Write-Host "Starting frontend at http://127.0.0.1:$WebPort"
    $frontend = Start-Process `
        -FilePath $pnpm `
        -ArgumentList $frontendArguments `
        -WorkingDirectory $frontendRoot `
        -NoNewWindow `
        -PassThru
    $processes.Add($frontend)

    Write-Host "Development servers are running. Press Ctrl+C to stop both."

    while ($true) {
        Start-Sleep -Milliseconds 500

        foreach ($process in $processes) {
            if ($process.HasExited) {
                throw "A development server exited unexpectedly with code $($process.ExitCode)."
            }
        }
    }
}
finally {
    Write-Host "Stopping development servers..."

    foreach ($process in $processes) {
        Stop-DevelopmentProcess -Process $process
    }
}
