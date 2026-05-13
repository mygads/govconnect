param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('channel-service', 'case-service', 'notification-service', 'ai-service', 'dashboard')]
  [string]$Name,
  [int]$Lines = 50
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtimeDir = Join-Path $PSScriptRoot 'dev-runtime'
$logsDir = Join-Path $runtimeDir 'logs'

$stdoutLog = Join-Path $logsDir "$Name.out.log"
$stderrLog = Join-Path $logsDir "$Name.err.log"

Write-Host ("=== STDOUT: {0} (last {1} lines) ===" -f $Name, $Lines) -ForegroundColor Cyan
if (Test-Path $stdoutLog) {
  Get-Content $stdoutLog -Tail $Lines | ForEach-Object { Write-Host $_ }
} else {
  Write-Host "(no stdout log found)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("=== STDERR: {0} (last {1} lines) ===" -f $Name, $Lines) -ForegroundColor Red
if (Test-Path $stderrLog) {
  Get-Content $stderrLog -Tail $Lines | ForEach-Object { Write-Host $_ -ForegroundColor DarkRed }
} else {
  Write-Host "(no stderr log found)" -ForegroundColor Yellow
}
