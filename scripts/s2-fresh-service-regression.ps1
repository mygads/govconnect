param(
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Endpoint {
  param([string]$Label, [string]$Url, [hashtable]$Headers = @{}, [int]$ExpectedStatus = 200)
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -Headers $Headers -TimeoutSec 10 -SkipHttpErrorCheck
    $pass = if ($r.StatusCode -eq $ExpectedStatus) { 'PASS' } else { 'FAIL' }
    $preview = $r.Content.Substring(0, [Math]::Min(60, $r.Content.Length))
    Write-Host ('[{0}] {1}: {2} | {3}' -f $pass, $Label, $r.StatusCode, $preview)
  } catch {
    Write-Host ('[ERROR] {0}: {1}' -f $Label, $_.Exception.Message)
  }
}

$headers = @{ 'x-internal-api-key' = $InternalApiKey; 'x-village-id' = $VillageId }

Write-Host '=== CHANNEL-SERVICE REGRESSION ==='
Test-Endpoint -Label 'channel health' -Url 'http://127.0.0.1:3001/health'
Test-Endpoint -Label 'channel messages (wa_user)' -Url ('http://127.0.0.1:3001/internal/messages?village_id={0}&wa_user_id=6289900152001&limit=5' -f $VillageId) -Headers $headers
Test-Endpoint -Label 'channel conversations' -Url ('http://127.0.0.1:3001/internal/conversations?village_id={0}&limit=5' -f $VillageId) -Headers $headers
Test-Endpoint -Label 'channel takeover status' -Url ('http://127.0.0.1:3001/internal/takeover/6289900152001/status?village_id={0}' -f $VillageId) -Headers $headers

Write-Host ''
Write-Host '=== CASE-SERVICE REGRESSION ==='
Test-Endpoint -Label 'case health' -Url 'http://127.0.0.1:3003/health'
Test-Endpoint -Label 'case laporan list' -Url ('http://127.0.0.1:3003/laporan?village_id={0}&limit=3' -f $VillageId) -Headers $headers
Test-Endpoint -Label 'case service-requests list' -Url ('http://127.0.0.1:3003/service-requests?village_id={0}&limit=3' -f $VillageId) -Headers $headers

Write-Host ''
Write-Host '=== NOTIFICATION-SERVICE REGRESSION ==='
Test-Endpoint -Label 'notification health' -Url 'http://127.0.0.1:3004/health'

Write-Host ''
Write-Host '=== RABBITMQ STATUS ==='
$queues = docker exec rabbitmq rabbitmqctl list_queues name messages consumers 2>&1
Write-Host ($queues -join "`n")
