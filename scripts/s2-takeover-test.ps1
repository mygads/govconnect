param(
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025',
  [string]$AdminId = 'cmkuvo1hv0002mj60yug4cc3s'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$headers = @{ 'x-internal-api-key' = $InternalApiKey; 'x-village-id' = $VillageId }
$channelBase = 'http://127.0.0.1:3001'

function Test-Result {
  param([string]$Label, [int]$Status, [int]$Expected = 200, [string]$Detail = '')
  $pass = if ($Status -eq $Expected) { 'PASS' } else { 'FAIL' }
  Write-Host ('[{0}] {1}: {2} (expected {3}) {4}' -f $pass, $Label, $Status, $Expected, $Detail)
}

Write-Host '=== S2-WA-011: Takeover activate/deactivate flow ==='
$testUser = '628991599001'

# Initial status
$uri = ('{0}/internal/takeover/{1}/status?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
Test-Result -Label 'Initial takeover status GET' -Status $r.StatusCode -Detail ('is_takeover={0}' -f $data.is_takeover)

# Activate: POST /internal/takeover/:wa_user_id
$body = @{ village_id = $VillageId; admin_id = $AdminId; reason = 's2_test_handoff' } | ConvertTo-Json -Compress
$uri = ('{0}/internal/takeover/{1}' -f $channelBase, $testUser)
$r = Invoke-WebRequest -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Takeover POST activate' -Status $r.StatusCode -Detail ($r.Content.Substring(0,[Math]::Min(120,$r.Content.Length)))

# Verify active
$uri = ('{0}/internal/takeover/{1}/status?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
Write-Host ('  after activate: is_takeover={0}' -f $data.is_takeover)

# Deactivate: DELETE /internal/takeover/:wa_user_id
$uri = ('{0}/internal/takeover/{1}?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Delete -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Takeover DELETE deactivate' -Status $r.StatusCode -Detail ($r.Content.Substring(0,[Math]::Min(120,$r.Content.Length)))

# Verify inactive
$uri = ('{0}/internal/takeover/{1}/status?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
Write-Host ('  after deactivate: is_takeover={0}' -f $data.is_takeover)

# List active takeovers
$uri = ('{0}/internal/takeover?village_id={1}' -f $channelBase, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Takeover list active' -Status $r.StatusCode
