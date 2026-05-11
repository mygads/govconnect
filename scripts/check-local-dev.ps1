param(
  [switch]$Json,
  [switch]$IncludeLogTail,
  [int]$TailLines = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtimeDir = Join-Path $PSScriptRoot 'dev-runtime'
$logsDir = Join-Path $runtimeDir 'logs'
$pidsDir = Join-Path $runtimeDir 'pids'

$services = @(
  @{ Name = 'channel-service'; HealthUrl = 'http://127.0.0.1:3001/health' },
  @{ Name = 'case-service'; HealthUrl = 'http://127.0.0.1:3003/health' },
  @{ Name = 'notification-service'; HealthUrl = 'http://127.0.0.1:3004/health' },
  @{ Name = 'ai-service'; HealthUrl = 'http://127.0.0.1:3002/health' },
  @{ Name = 'dashboard'; HealthUrl = 'http://127.0.0.1:3010/api/health' }
)

function Test-ServiceHealth {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck
    return [pscustomobject]@{
      Healthy = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
      StatusCode = $response.StatusCode
      Error = $null
    }
  } catch {
    return [pscustomobject]@{
      Healthy = $false
      StatusCode = $null
      Error = $_.Exception.Message
    }
  }
}

function Get-LogTail {
  param(
    [string]$Path,
    [int]$Lines
  )

  if (-not (Test-Path $Path)) {
    return @()
  }

  return @(
    Get-Content $Path -Tail $Lines -ErrorAction SilentlyContinue |
      Where-Object { $_ -and $_.Trim().Length -gt 0 }
  )
}

function Get-LastNonEmptyLine {
  param([string[]]$Lines)

  $nonEmpty = @($Lines | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  if ($nonEmpty.Count -eq 0) {
    return $null
  }

  return $nonEmpty[-1]
}

function Get-ServiceSnapshot {
  param([hashtable]$Service)

  $name = $Service.Name
  $pidFile = Join-Path $pidsDir "$name.pid"
  $stdoutLog = Join-Path $logsDir "$name.out.log"
  $stderrLog = Join-Path $logsDir "$name.err.log"

  $servicePid = $null
  if (Test-Path $pidFile) {
    $rawPid = (Get-Content $pidFile -Raw).Trim()
    if ($rawPid) {
      $servicePid = [int]$rawPid
    }
  }

  $process = $null
  if ($servicePid) {
    $process = Get-Process -Id $servicePid -ErrorAction SilentlyContinue
  }

  $health = Test-ServiceHealth -Url $Service.HealthUrl
  $stdoutTail = if ($IncludeLogTail) { Get-LogTail -Path $stdoutLog -Lines $TailLines } else { @() }
  $stderrTail = if ($IncludeLogTail) { Get-LogTail -Path $stderrLog -Lines $TailLines } else { @() }
  $hintLines = @($stdoutTail + $stderrTail)
  $hintText = ($hintLines -join "`n").ToLowerInvariant()
  $lastError = Get-LastNonEmptyLine -Lines $stderrTail

  $startedRecently = $false
  if ($process) {
    try {
      $startedRecently = $process.StartTime -gt (Get-Date).AddMinutes(-2)
    } catch {
      $startedRecently = $false
    }
  }

  $status = if ($process -and $health.Healthy) {
    'healthy'
  } elseif ($process -and -not $health.Healthy) {
    if ($startedRecently -or $hintText -match 'starting|watch|compiled|ready|listening|dev server') {
      'starting'
    } else {
      'unhealthy'
    }
  } elseif ((Test-Path $pidFile) -or (Test-Path $stdoutLog) -or (Test-Path $stderrLog)) {
    'crashed'
  } else {
    'missing'
  }

  return [pscustomobject]@{
    name = $name
    status = $status
    pid = $servicePid
    processRunning = [bool]$process
    healthUrl = $Service.HealthUrl
    healthy = $health.Healthy
    healthStatusCode = $health.StatusCode
    healthError = $health.Error
    pidFile = $pidFile
    stdoutLog = $stdoutLog
    stderrLog = $stderrLog
    lastError = $lastError
    recentStdout = if ($IncludeLogTail) { $stdoutTail } else { $null }
    recentStderr = if ($IncludeLogTail) { $stderrTail } else { $null }
  }
}

$runtimeExists = (Test-Path $runtimeDir) -or (Test-Path $pidsDir) -or (Test-Path $logsDir)
$serviceSnapshots = @($services | ForEach-Object { Get-ServiceSnapshot -Service $_ })

$overallStatus = if (-not $runtimeExists -or ($serviceSnapshots | Where-Object { $_.status -ne 'missing' }).Count -eq 0) {
  'missing'
} elseif (($serviceSnapshots | Where-Object { $_.status -eq 'unhealthy' -or $_.status -eq 'crashed' }).Count -gt 0) {
  'degraded'
} elseif (($serviceSnapshots | Where-Object { $_.status -eq 'starting' }).Count -gt 0) {
  'starting'
} elseif (($serviceSnapshots | Where-Object { $_.status -eq 'healthy' }).Count -eq $serviceSnapshots.Count) {
  'healthy'
} else {
  'partial'
}

$result = [pscustomobject]@{
  overallStatus = $overallStatus
  runtimeDir = $runtimeDir
  logsDir = $logsDir
  pidsDir = $pidsDir
  services = $serviceSnapshots
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6
  exit 0
}

Write-Host ("Overall runtime status: {0}" -f $overallStatus)
foreach ($service in $serviceSnapshots) {
  $healthText = if ($service.healthy) {
    "ok($($service.healthStatusCode))"
  } elseif ($service.healthStatusCode) {
    "http-$($service.healthStatusCode)"
  } elseif ($service.healthError) {
    $service.healthError
  } else {
    'unreachable'
  }

  Write-Host ("- {0}: status={1} pid={2} health={3}" -f $service.name, $service.status, ($service.pid ?? '-'), $healthText)
  if ($service.lastError) {
    Write-Host ("  lastError: {0}" -f $service.lastError)
  }
}

Write-Host ("Logs directory: {0}" -f $logsDir)
Write-Host ("PID directory: {0}" -f $pidsDir)
