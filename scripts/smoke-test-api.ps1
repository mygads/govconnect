param(
  [string]$DashboardUrl = $env:DASHBOARD_URL,
  [string]$AiServiceUrl = $env:AI_SERVICE_URL,
  [string]$ChannelServiceUrl = $env:CHANNEL_SERVICE_URL,
  [string]$InternalApiKey = $env:INTERNAL_API_KEY,
  [string]$VillageId = $env:TEST_VILLAGE_ID,
  [string]$ChannelIdentifier = "web_smoke_handoff"
)

if (-not $DashboardUrl) { $DashboardUrl = "http://localhost:3010" }
if (-not $AiServiceUrl) { $AiServiceUrl = "http://localhost:3002" }
if (-not $ChannelServiceUrl) { $ChannelServiceUrl = "http://localhost:3001" }
if (-not $InternalApiKey) { throw "INTERNAL_API_KEY is required" }
if (-not $VillageId) { $VillageId = "smoke-village" }

$headers = @{ "x-internal-api-key" = $InternalApiKey; "Content-Type" = "application/json" }
$failures = @()

function Test-Http {
  param([string]$Name, [scriptblock]$Call)
  try {
    & $Call | Out-Null
    Write-Host "PASS $Name"
  } catch {
    Write-Warning "FAIL $Name :: $($_.Exception.Message)"
    $script:failures += $Name
  }
}

Test-Http "dashboard village behavior auth rejection" {
  try {
    Invoke-RestMethod -Method Get -Uri "$DashboardUrl/api/internal/village-behavior?village_id=$VillageId" -ErrorAction Stop | Out-Null
    throw "expected unauthorized"
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
  }
}

Test-Http "dashboard village behavior upsert/get" {
  $body = @{ village_id = $VillageId; config = @{ local_faq_priority = @('Jam layanan'); complaint_rules = @('Prioritaskan laporan darurat') } } | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Method Put -Uri "$DashboardUrl/api/internal/village-behavior" -Headers $headers -Body $body | Out-Null
  $res = Invoke-RestMethod -Method Get -Uri "$DashboardUrl/api/internal/village-behavior?village_id=$VillageId" -Headers $headers
  if (-not $res.data.config.local_faq_priority) { throw "missing local_faq_priority" }
}

Test-Http "ai token usage tenant flow endpoint" {
  Invoke-RestMethod -Method Get -Uri "$AiServiceUrl/stats/token-usage/by-tenant-flow" -Headers $headers | Out-Null
}

Test-Http "ai token usage intent family endpoint" {
  Invoke-RestMethod -Method Get -Uri "$AiServiceUrl/stats/token-usage/by-intent-family" -Headers $headers | Out-Null
}

Test-Http "channel takeover enrichment endpoint" {
  $body = @{
    admin_id = 'smoke-test'
    admin_name = 'Smoke Test'
    reason = 'api_smoke_test'
    channel = 'WEBCHAT'
    enrichment = @{ intent = 'TAKEOVER'; escalation_reason = 'api_smoke_test'; recent_messages = @() }
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod -Method Post -Uri "$ChannelServiceUrl/internal/takeover/${ChannelIdentifier}?village_id=$VillageId&channel=WEBCHAT" -Headers $headers -Body $body | Out-Null

  $status = Invoke-RestMethod -Method Get -Uri "$ChannelServiceUrl/internal/takeover/${ChannelIdentifier}/status?village_id=$VillageId&channel=WEBCHAT" -Headers $headers
  if (-not ($status.is_takeover -eq $true -or $status.success -eq $true)) { throw "takeover status check returned unexpected payload" }

  Invoke-RestMethod -Method Delete -Uri "$ChannelServiceUrl/internal/takeover/${ChannelIdentifier}?village_id=$VillageId&channel=WEBCHAT" -Headers $headers | Out-Null
}

if ($failures.Count -gt 0) {
  Write-Error "API smoke test failed: $($failures -join ', ')"
  exit 1
}

Write-Host "All API smoke tests passed"

