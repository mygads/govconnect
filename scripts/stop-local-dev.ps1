Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runtimeDir = Join-Path $PSScriptRoot 'dev-runtime'
$pidsDir = Join-Path $runtimeDir 'pids'

if (-not (Test-Path $pidsDir)) {
  Write-Host 'No local dev pid directory found.'
  exit 0
}

$pidFiles = Get-ChildItem $pidsDir -Filter *.pid -ErrorAction SilentlyContinue
foreach ($pidFile in $pidFiles) {
  $rawPid = (Get-Content $pidFile.FullName -Raw).Trim()
  if ($rawPid) {
    $proc = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $proc.Id -Force
    }
  }
  Remove-Item $pidFile.FullName -Force -ErrorAction SilentlyContinue
}

Write-Host 'Local dev daemons stopped.'
