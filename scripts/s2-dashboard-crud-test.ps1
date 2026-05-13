param(
  [string]$DashboardBase = 'http://127.0.0.1:3010',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025',
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Result {
  param([string]$Label, [int]$Status, [int]$Expected = 200, [string]$Detail = '')
  $pass = if ($Status -eq $Expected) { 'PASS' } else { 'FAIL' }
  Write-Host ('[{0}] {1}: {2} (expected {3}) {4}' -f $pass, $Label, $Status, $Expected, $Detail)
}

# Get VA token from DB (avoid rate limit)
$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$headers = @{ 'Cookie' = ('token=' + $vaToken); 'Content-Type' = 'application/json' }

Write-Host '=== S2-DASH: Knowledge CRUD roundtrip ==='

# Create test KB entry
$createBody = @{
  title = ('s2_test_kb_' + (Get-Date -Format 'HHmmss'))
  content = 'This is a Session 2 test knowledge base entry for CRUD validation. Dummy content.'
  category = 'Custom'
  keywords = @('s2_test','regression')
  is_active = $true
  priority = 5
} | ConvertTo-Json -Compress

$r = Invoke-WebRequest -Method Post -Uri "$DashboardBase/api/knowledge" -Headers $headers -Body $createBody -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Knowledge POST create' -Status $r.StatusCode -Expected 201
$created = $r.Content | ConvertFrom-Json
$newId = $created.data.id
Write-Host ('  created id: {0}' -f $newId)

# Read back
$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/knowledge/{1}' -f $DashboardBase, $newId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Knowledge GET by id' -Status $r.StatusCode

# Update title
$updateBody = @{ title = 'updated_s2_test_kb' } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Put -Uri ('{0}/api/knowledge/{1}' -f $DashboardBase, $newId) -Headers $headers -Body $updateBody -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Knowledge PUT update' -Status $r.StatusCode

# Delete
$r = Invoke-WebRequest -Method Delete -Uri ('{0}/api/knowledge/{1}' -f $DashboardBase, $newId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Knowledge DELETE' -Status $r.StatusCode

# Verify deleted
$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/knowledge/{1}' -f $DashboardBase, $newId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Knowledge verify deleted' -Status $r.StatusCode -Expected 404

Write-Host ''
Write-Host '=== S2-DASH: Important contacts CRUD ==='

# List existing
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/important-contacts" -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Important contacts GET list' -Status $r.StatusCode
$list = $r.Content | ConvertFrom-Json
Write-Host ('  existing count: {0}' -f $list.data.Count)

# Get categories
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/important-contacts/categories" -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Important contacts categories' -Status $r.StatusCode
$cats = $r.Content | ConvertFrom-Json
$firstCatId = $cats.data[0].id
Write-Host ('  first category id: {0}' -f $firstCatId)

# Create test contact
$createBody = @{
  name = ('s2_test_contact_' + (Get-Date -Format 'HHmmss'))
  phone = '+62 812-3456-7890'
  description = 's2 regression test contact'
  category_id = $firstCatId
} | ConvertTo-Json -Compress

$r = Invoke-WebRequest -Method Post -Uri "$DashboardBase/api/important-contacts" -Headers $headers -Body $createBody -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Important contact POST create' -Status $r.StatusCode -Expected 201
$created = $r.Content | ConvertFrom-Json
$contactId = if ($created.data) { $created.data.id } else { $null }
Write-Host ('  created contact id: {0}' -f $contactId)

if ($contactId) {
  # Delete
  $r = Invoke-WebRequest -Method Delete -Uri ('{0}/api/important-contacts/{1}' -f $DashboardBase, $contactId) -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
  Test-Result -Label 'Important contact DELETE' -Status $r.StatusCode
}

Write-Host ''
Write-Host '=== S2-DASH: Village profile read + edit roundtrip ==='

# GET current
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/village-profile" -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Village profile GET' -Status $r.StatusCode
$profile = $r.Content | ConvertFrom-Json
$origAddress = $profile.data.address
Write-Host ('  orig address: {0}' -f $origAddress)

# PUT update (append marker)
$newAddress = $origAddress + ' [s2_test]'
$updateBody = @{ address = $newAddress } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Put -Uri "$DashboardBase/api/village-profile" -Headers $headers -Body $updateBody -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Village profile PUT update' -Status $r.StatusCode

# Verify update
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/village-profile" -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$updated = $r.Content | ConvertFrom-Json
$markerPresent = $updated.data.address -like '*[s2_test]*'
Write-Host ('  marker present after update: {0}' -f $markerPresent)

# Revert
$revertBody = @{ address = $origAddress } | ConvertTo-Json -Compress
$r = Invoke-WebRequest -Method Put -Uri "$DashboardBase/api/village-profile" -Headers $headers -Body $revertBody -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Village profile PUT revert' -Status $r.StatusCode

# Verify reverted
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/village-profile" -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
$reverted = $r.Content | ConvertFrom-Json
$isReverted = $reverted.data.address -eq $origAddress
Write-Host ('  reverted correctly: {0}' -f $isReverted)
