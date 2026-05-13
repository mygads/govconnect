param(
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$headers = @{
  'x-internal-api-key' = $InternalApiKey
  'x-village-id' = $VillageId
}

function Test-Result {
  param([string]$Label, [int]$Status, [int]$Expected = 200, [string]$Detail = '')
  $pass = if ($Status -eq $Expected) { 'PASS' } else { 'FAIL' }
  Write-Host ('[{0}] {1}: {2} (expected {3}) {4}' -f $pass, $Label, $Status, $Expected, $Detail)
}

Write-Host '=== S2-WA-008: Status check by LAP/LAY number ==='

# Get latest LAP and LAY numbers
$r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3003/laporan?village_id={0}&limit=1' -f $VillageId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$lapList = $r.Content | ConvertFrom-Json
$lapId = $lapList.data[0].complaint_id
$lapDbId = $lapList.data[0].id
Test-Result -Label 'Get latest LAP' -Status $r.StatusCode -Detail ('LAP={0} dbId={1}' -f $lapId, $lapDbId)

$r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3003/service-requests?village_id={0}&limit=1' -f $VillageId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$layList = $r.Content | ConvertFrom-Json
$layId = $layList.data[0].request_number
$layDbId = $layList.data[0].id
Test-Result -Label 'Get latest LAY' -Status $r.StatusCode -Detail ('LAY={0} dbId={1}' -f $layId, $layDbId)

# Lookup complaint by dbId
$r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3003/laporan/{0}?village_id={1}' -f $lapDbId, $VillageId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label ('Lookup LAP by dbId ' + $lapDbId.Substring(0,8)) -Status $r.StatusCode
$lapData = $r.Content | ConvertFrom-Json
Write-Host ('  current status: {0}' -f $lapData.data.status)

# Lookup service request by dbId
$r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3003/service-requests/{0}?village_id={1}' -f $layDbId, $VillageId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label ('Lookup LAY by dbId ' + $layDbId.Substring(0,8)) -Status $r.StatusCode
$layData = $r.Content | ConvertFrom-Json
Write-Host ('  current status: {0}' -f $layData.data.status)

Write-Host ''
Write-Host '=== S2-CASE: Complaint status update roundtrip ==='

# Update LAP status (from DONE to DONE with new note) - safe roundtrip
$currentStatus = $lapData.data.status
$body = @{ status = $currentStatus; admin_notes = ('[s2_regression_test] roundtrip at ' + (Get-Date -Format 'HH:mm:ss')) } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('http://127.0.0.1:3003/laporan/{0}/status?village_id={1}' -f $lapDbId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'PATCH LAP status (roundtrip)' -Status $r.StatusCode

# Verify update persisted
$r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3003/laporan/{0}?village_id={1}' -f $lapDbId, $VillageId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$updated = $r.Content | ConvertFrom-Json
$noteMatch = $updated.data.admin_notes -like '*s2_regression_test*'
Write-Host ('  admin_notes updated: {0}' -f $noteMatch)

Write-Host ''
Write-Host '=== S2-CASE: Service request status update roundtrip ==='

$currentLayStatus = $layData.data.status
$body = @{ status = $currentLayStatus; admin_notes = ('[s2_regression_test] lay roundtrip at ' + (Get-Date -Format 'HH:mm:ss')) } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('http://127.0.0.1:3003/service-requests/{0}/status?village_id={1}' -f $layDbId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'PATCH LAY status (roundtrip)' -Status $r.StatusCode

# Verify update
$r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3003/service-requests/{0}?village_id={1}' -f $layDbId, $VillageId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$updatedLay = $r.Content | ConvertFrom-Json
$layNoteMatch = $updatedLay.data.admin_notes -like '*s2_regression_test*'
Write-Host ('  LAY admin_notes updated: {0}' -f $layNoteMatch)
