param(
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$headers = @{ 'x-internal-api-key' = $InternalApiKey; 'x-village-id' = $VillageId }
$caseBase = 'http://127.0.0.1:3003'
$channelBase = 'http://127.0.0.1:3001'

function Test-Result {
  param([string]$Label, [int]$Status, [int]$Expected = 200, [string]$Detail = '')
  $pass = if ($Status -eq $Expected) { 'PASS' } else { 'FAIL' }
  Write-Host ('[{0}] {1}: {2} (expected {3}) {4}' -f $pass, $Label, $Status, $Expected, $Detail)
}

Write-Host '=== S2-CASE: Complaint status transitions ==='

$lapId = 'cmocjizzf001xjtvs5jlztdy9'  # LAP-20260424-023, OPEN
$origNotes = 's2_test_' + (Get-Date -Format 'HHmmss')

# OPEN -> PROCESS
$body = @{ status = 'PROCESS'; admin_notes = $origNotes } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('{0}/laporan/{1}/status?village_id={2}' -f $caseBase, $lapId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'LAP OPEN->PROCESS' -Status $r.StatusCode

# Verify update
$uri = ('{0}/laporan/{1}?village_id={2}' -f $caseBase, $lapId, $VillageId)
$r2 = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r2.Content | ConvertFrom-Json
$notesMatch = $data.data.admin_notes -like ('*' + $origNotes + '*')
Write-Host ('  verified: status={0} notes_match={1}' -f $data.data.status, $notesMatch)

# PROCESS -> DONE
$body = @{ status = 'DONE'; admin_notes = ($origNotes + '_done') } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('{0}/laporan/{1}/status?village_id={2}' -f $caseBase, $lapId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'LAP PROCESS->DONE' -Status $r.StatusCode

# Invalid: DONE -> OPEN
$body = @{ status = 'OPEN'; admin_notes = 'should fail' } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('{0}/laporan/{1}/status?village_id={2}' -f $caseBase, $lapId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'LAP DONE->OPEN (invalid)' -Status $r.StatusCode -Expected 400

Write-Host ''
Write-Host '=== S2-CASE: Service request status transitions ==='

$layId = 'cmoe8acyy000fr001pv0i09pm'  # LAY-20260425-005, PROCESS
$layNotes = 's2_lay_test_' + (Get-Date -Format 'HHmmss')

# PROCESS -> DONE
$body = @{ status = 'DONE'; admin_notes = $layNotes } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('{0}/service-requests/{1}/status?village_id={2}' -f $caseBase, $layId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'LAY PROCESS->DONE' -Status $r.StatusCode

# Verify
$uri = ('{0}/service-requests/{1}?village_id={2}' -f $caseBase, $layId, $VillageId)
$r2 = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r2.Content | ConvertFrom-Json
$notesMatch = $data.data.admin_notes -like ('*' + $layNotes + '*')
Write-Host ('  verified: status={0} notes_match={1}' -f $data.data.status, $notesMatch)

# Invalid: DONE -> REJECTED
$body = @{ status = 'REJECTED'; admin_notes = 'should fail' } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Patch -Uri ('{0}/service-requests/{1}/status?village_id={2}' -f $caseBase, $layId, $VillageId) -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'LAY DONE->REJECTED (invalid)' -Status $r.StatusCode -Expected 400

Write-Host ''
Write-Host '=== S2-WA-011: Takeover flow ==='

$testUser = '628991543000'

# Check initial status
$uri = ('{0}/internal/takeover/{1}/status?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
Write-Host ('Initial takeover status for {0}: is_takeover={1}' -f $testUser, $data.is_takeover)

# Activate takeover
$body = @{ village_id = $VillageId; admin_id = 'cmkuvo1hv0002mj60yug4cc3s'; reason = 's2_test_handoff' } | ConvertTo-Json -Compress
$uri = ('{0}/internal/takeover/{1}/activate' -f $channelBase, $testUser)
$r = Invoke-WebRequest -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Takeover activate' -Status $r.StatusCode

# Verify active
$uri = ('{0}/internal/takeover/{1}/status?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
Write-Host ('  after activate: is_takeover={0}' -f $data.is_takeover)

# Deactivate
$body = @{ village_id = $VillageId } | ConvertTo-Json -Compress
$uri = ('{0}/internal/takeover/{1}/deactivate' -f $channelBase, $testUser)
$r = Invoke-WebRequest -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Takeover deactivate' -Status $r.StatusCode

# Verify inactive
$uri = ('{0}/internal/takeover/{1}/status?village_id={2}' -f $channelBase, $testUser, $VillageId)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
Write-Host ('  after deactivate: is_takeover={0}' -f $data.is_takeover)
