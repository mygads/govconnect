param(
  [string]$AiServiceUrl = $env:AI_SERVICE_URL,
  [string]$InternalApiKey = $env:INTERNAL_API_KEY,
  [int]$IntervalMinutes = 0,
  [int]$MaxRuns = 1,
  [string]$OutputDir = "scripts/qa-results/eval-runs"
)

if (-not $AiServiceUrl) { $AiServiceUrl = "http://localhost:3002" }
if (-not $InternalApiKey) { throw "INTERNAL_API_KEY is required" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$aiDir = Join-Path $repoRoot "govconnect-ai-service"
$outDir = Join-Path $repoRoot $OutputDir
New-Item -ItemType Directory -Force $outDir | Out-Null

$runCount = 0
$failures = 0

while ($true) {
  $runCount += 1
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outFile = Join-Path $outDir "golden-set-$timestamp.json"
  Write-Host "[$timestamp] Running golden-set regression harness ($runCount/$MaxRuns)..."

  Push-Location $aiDir
  try {
    $env:AI_SERVICE_URL = $AiServiceUrl
    $env:INTERNAL_API_KEY = $InternalApiKey
    $output = npm run golden-set:eval 2>&1
    $exitCode = $LASTEXITCODE
    $output | Set-Content $outFile
    if ($exitCode -ne 0) {
      $failures += 1
      Write-Warning "Golden-set run failed. Output: $outFile"
    } else {
      Write-Host "Golden-set run passed. Output: $outFile"
    }
  } finally {
    Pop-Location
  }

  if ($IntervalMinutes -le 0 -or $runCount -ge $MaxRuns) { break }
  Start-Sleep -Seconds ($IntervalMinutes * 60)
}

if ($failures -gt 0) { exit 1 }
