param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('channel-service', 'case-service', 'notification-service', 'ai-service', 'dashboard')]
  [string]$Name,
  [switch]$RunMigrate,
  [int]$WaitTimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $PSScriptRoot 'dev-runtime'
$logsDir = Join-Path $runtimeDir 'logs'
$pidsDir = Join-Path $runtimeDir 'pids'

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
New-Item -ItemType Directory -Force -Path $pidsDir | Out-Null

$services = @(
  @{
    Name = 'channel-service'
    Workdir = Join-Path $root 'govconnect-channel-service'
    Command = 'npx tsx watch src/server.ts'
    HealthUrl = 'http://127.0.0.1:3001/health'
    Migrate = $true
  },
  @{
    Name = 'case-service'
    Workdir = Join-Path $root 'govconnect-case-service'
    Command = 'npx tsx watch src/server.ts'
    HealthUrl = 'http://127.0.0.1:3003/health'
    Migrate = $true
  },
  @{
    Name = 'notification-service'
    Workdir = Join-Path $root 'govconnect-notification-service'
    Command = 'npx tsx watch src/server.ts'
    HealthUrl = 'http://127.0.0.1:3004/health'
    Migrate = $true
  },
  @{
    Name = 'ai-service'
    Workdir = Join-Path $root 'govconnect-ai-service'
    Command = 'npx tsx watch src/server.ts'
    HealthUrl = 'http://127.0.0.1:3002/health'
    Migrate = $true
  },
  @{
    Name = 'dashboard'
    Workdir = Join-Path $root 'govconnect-dashboard'
    Command = 'npx next dev -p 3010'
    HealthUrl = 'http://127.0.0.1:3010/api/health'
    Migrate = $true
  }
)

function Stop-ExistingLocalProcess {
  param([string]$ServiceName)

  $pidFile = Join-Path $pidsDir "$ServiceName.pid"
  if (-not (Test-Path $pidFile)) {
    return
  }

  $rawPid = (Get-Content $pidFile -Raw).Trim()
  if (-not $rawPid) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return
  }

  $existing = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-Process -Id $existing.Id -Force
    Start-Sleep -Seconds 1
  }

  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds 2
  }

  throw "Timeout waiting for $Url"
}

$service = $services | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
if (-not $service) {
  throw "Unknown service: $Name"
}

if ($RunMigrate -and $service.Migrate) {
  Write-Host ("Checking Prisma migration status for {0}..." -f $service.Name)
  Push-Location $service.Workdir
  try {
    pnpm db:migrate:status
    Write-Host ("Applying Prisma migrations for {0}..." -f $service.Name)
    pnpm db:migrate:deploy
  } finally {
    Pop-Location
  }
}

Stop-ExistingLocalProcess -ServiceName $service.Name

$stdout = Join-Path $logsDir "$($service.Name).out.log"
$stderr = Join-Path $logsDir "$($service.Name).err.log"
if (Test-Path $stdout) { Remove-Item $stdout -Force }
if (Test-Path $stderr) { Remove-Item $stderr -Force }

$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    "Set-Location '$($service.Workdir)'; $($service.Command)"
  ) `
  -WorkingDirectory $service.Workdir `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Set-Content -Path (Join-Path $pidsDir "$($service.Name).pid") -Value $proc.Id
Wait-ForUrl -Url $service.HealthUrl -TimeoutSeconds $WaitTimeoutSeconds

Write-Host ("Restarted {0}: pid={1} health={2}" -f $service.Name, $proc.Id, $service.HealthUrl)
Write-Host ("stdout={0}" -f $stdout)
Write-Host ("stderr={0}" -f $stderr)
