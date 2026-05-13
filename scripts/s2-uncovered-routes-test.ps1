param(
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$caseBase = 'http://127.0.0.1:3003'
$channelBase = 'http://127.0.0.1:3001'
$notifBase = 'http://127.0.0.1:3004'
$headers = @{ 'x-internal-api-key' = $InternalApiKey; 'x-village-id' = $VillageId; 'x-admin-role' = 'village_admin' }

$script:pass = 0
$script:fail = 0
$script:createdIds = @{}

function Test-Result {
  param([string]$Label, [int]$Status, [int]$Expected = 200, [string]$Detail = '')
  $ok = $Status -eq $Expected
  if ($ok) { $script:pass++ } else { $script:fail++ }
  $tag = if ($ok) { 'PASS' } else { 'FAIL' }
  Write-Host ('[{0}] {1}: {2} (expected {3}) {4}' -f $tag, $Label, $Status, $Expected, $Detail)
  return $ok
}

function Invoke-Api {
  param([string]$Method, [string]$Url, $Body = $null, [hashtable]$ExtraHeaders = $null, [int]$Timeout = 10)
  $h = $headers.Clone()
  if ($ExtraHeaders) { foreach ($k in $ExtraHeaders.Keys) { $h[$k] = $ExtraHeaders[$k] } }
  $params = @{ Method = $Method; Uri = $Url; Headers = $h; TimeoutSec = $Timeout; SkipHttpErrorCheck = $true }
  if ($Body) {
    $params.ContentType = 'application/json'
    $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 -Compress }
  }
  return Invoke-WebRequest @params
}

Write-Host '=== S2-CASE-STAT: Complaint statistics endpoints ==='

$r = Invoke-Api -Method Get -Url ('{0}/laporan/statistics?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/laporan/statistics' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/laporan/realtime-summary?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/laporan/realtime-summary' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/laporan/deleted?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/laporan/deleted list' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/statistics/overview?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/statistics/overview' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/statistics/by-category?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/statistics/by-category' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/statistics/by-status?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/statistics/by-status' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/statistics/trends?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label '/statistics/trends' -Status $r.StatusCode

Write-Host ''
Write-Host '=== S2-CASE-CATALOG: Service catalog public + CRUD ==='

$r = Invoke-Api -Method Get -Url ('{0}/service-categories?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label 'GET /service-categories' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/services?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label 'GET /services' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/services/search?village_id={1}&q=domisili' -f $caseBase, $VillageId)
Test-Result -Label 'GET /services/search' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/services/by-slug?village_id={1}&slug=administrasi-kependudukan-keterangan-domisili' -f $caseBase, $VillageId)
Test-Result -Label 'GET /services/by-slug' -Status $r.StatusCode

# Create a test service category (CRUD roundtrip)
$categoryBody = @{
  village_id = $VillageId
  name = ('s2_test_cat_' + (Get-Date -Format 'HHmmss'))
  description = 's2 regression test category'
}
$r = Invoke-Api -Method Post -Url ('{0}/service-categories' -f $caseBase) -Body $categoryBody
$created = if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 201) { 201 } else { $r.StatusCode }
Test-Result -Label 'POST /service-categories' -Status $created -Expected 201
$catData = $r.Content | ConvertFrom-Json
$newCatId = if ($catData.data) { $catData.data.id } else { $null }

if ($newCatId) {
  # Update
  $updBody = @{ name = ('s2_test_cat_updated_' + (Get-Date -Format 'HHmmss')) }
  $r = Invoke-Api -Method Patch -Url ('{0}/service-categories/{1}?village_id={2}' -f $caseBase, $newCatId, $VillageId) -Body $updBody
  Test-Result -Label 'PATCH /service-categories/:id' -Status $r.StatusCode

  # Delete
  $r = Invoke-Api -Method Delete -Url ('{0}/service-categories/{1}?village_id={2}' -f $caseBase, $newCatId, $VillageId)
  $ok = $r.StatusCode -eq 200 -or $r.StatusCode -eq 204
  Test-Result -Label 'DELETE /service-categories/:id' -Status $r.StatusCode -Expected ($(if ($ok) { $r.StatusCode } else { 200 }))
}

Write-Host ''
Write-Host '=== S2-CASE-COMPLAINT: Complaint categories + types CRUD ==='

$r = Invoke-Api -Method Get -Url ('{0}/complaints/categories?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label 'GET /complaints/categories' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/complaints/types?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label 'GET /complaints/types' -Status $r.StatusCode
$typesData = $r.Content | ConvertFrom-Json
$existingCategoryId = if ($typesData.data.Count -gt 0) { $typesData.data[0].category_id } else { 'cmkuvo1dk0000mj60h4u4bq1w-infrastruktur-utilitas' }

# Create a test complaint category
$compCatBody = @{
  village_id = $VillageId
  name = ('s2_test_compcat_' + (Get-Date -Format 'HHmmss'))
  description = 's2 test complaint category'
}
$r = Invoke-Api -Method Post -Url ('{0}/complaints/categories' -f $caseBase) -Body $compCatBody
$created = if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 201) { 201 } else { $r.StatusCode }
Test-Result -Label 'POST /complaints/categories' -Status $created -Expected 201
$compCatData = $r.Content | ConvertFrom-Json
$newCompCatId = if ($compCatData.data) { $compCatData.data.id } else { $null }

if ($newCompCatId) {
  # Create type under new category
  $typeBody = @{
    category_id = $newCompCatId
    name = 's2_test_type'
    is_urgent = $false
    require_address = $false
  }
  $r = Invoke-Api -Method Post -Url ('{0}/complaints/types' -f $caseBase) -Body $typeBody
  $typeCreated = if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 201) { 201 } else { $r.StatusCode }
  Test-Result -Label 'POST /complaints/types' -Status $typeCreated -Expected 201
  $typeData = $r.Content | ConvertFrom-Json
  $newTypeId = if ($typeData.data) { $typeData.data.id } else { $null }

  if ($newTypeId) {
    $r = Invoke-Api -Method Delete -Url ('{0}/complaints/types/{1}?village_id={2}' -f $caseBase, $newTypeId, $VillageId)
    Test-Result -Label 'DELETE /complaints/types/:id' -Status $r.StatusCode
  }

  $r = Invoke-Api -Method Delete -Url ('{0}/complaints/categories/{1}?village_id={2}' -f $caseBase, $newCompCatId, $VillageId)
  Test-Result -Label 'DELETE /complaints/categories/:id' -Status $r.StatusCode
}

Write-Host ''
Write-Host '=== S2-CASE-COMPLAINT: Direct complaint create + cancel ==='

$compBody = @{
  wa_user_id = '6289916487001'
  kategori = 'Infrastruktur'
  deskripsi = 's2_test complaint direct via case-service API'
  alamat = 'Dusun Test RT 01/02'
  village_id = $VillageId
  channel = 'WHATSAPP'
  reporter_name = 'S2 Test Resident'
}
$r = Invoke-Api -Method Post -Url ('{0}/laporan/create' -f $caseBase) -Body $compBody -Timeout 30
$created = if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 201) { 201 } else { $r.StatusCode }
Test-Result -Label 'POST /laporan/create' -Status $created -Expected 201
$newCompId = $null
$compComplaintId = '-'
if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 201) {
  $compData = $r.Content | ConvertFrom-Json
  if ($compData.PSObject.Properties.Name -contains 'data') {
    $newCompId = $compData.data.id
    $compComplaintId = $compData.data.complaint_id
  }
}
Write-Host ('  new complaint id: {0}, complaint_id: {1}' -f $newCompId, $compComplaintId)

if ($newCompId) {
  # Soft delete
  $r = Invoke-Api -Method Patch -Url ('{0}/laporan/{1}/soft-delete?village_id={2}' -f $caseBase, $newCompId, $VillageId)
  Test-Result -Label 'PATCH /laporan/:id/soft-delete' -Status $r.StatusCode

  # Restore
  $r = Invoke-Api -Method Patch -Url ('{0}/laporan/{1}/restore?village_id={2}' -f $caseBase, $newCompId, $VillageId)
  Test-Result -Label 'PATCH /laporan/:id/restore' -Status $r.StatusCode

  # Cancel
  $cancelBody = @{ reason = 's2_test cancel' }
  $r = Invoke-Api -Method Post -Url ('{0}/laporan/{1}/cancel?village_id={2}' -f $caseBase, $newCompId, $VillageId) -Body $cancelBody
  Test-Result -Label 'POST /laporan/:id/cancel' -Status $r.StatusCode
}

Write-Host ''
Write-Host '=== S2-CASE-USER: User history ==='

$r = Invoke-Api -Method Get -Url ('{0}/user/6289916487001/history?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label 'GET /user/:wa_user_id/history' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/service-requests/history/6289916487001?village_id={1}' -f $caseBase, $VillageId)
Test-Result -Label 'GET /service-requests/history/:wa_user_id' -Status $r.StatusCode

Write-Host ''
Write-Host '=== S2-CHANNEL: Non-destructive read endpoints ==='

$r = Invoke-Api -Method Get -Url ('{0}/internal/channel-accounts' -f $channelBase)
Test-Result -Label 'GET /internal/channel-accounts' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/channel-accounts/{1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/channel-accounts/:village_id' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/settings?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/settings' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/status?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/status' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/activity?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/activity' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/contacts?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/contacts' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/s3?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/s3' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/proxy-config?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/proxy-config' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/whatsapp/webhook-audit?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/whatsapp/webhook-audit' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/spam-guard/stats?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/spam-guard/stats' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/spam-guard/bans?village_id={1}' -f $channelBase, $VillageId)
Test-Result -Label 'GET /internal/spam-guard/bans' -Status $r.StatusCode

# GET /webhook (WhatsApp verify endpoint)
$r = Invoke-WebRequest -Method Get -Uri ('{0}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=any&hub.challenge=test123' -f $channelBase) -TimeoutSec 10 -SkipHttpErrorCheck
# GET webhook - accepts any status; it's a verify endpoint
Write-Host ('GET /webhook/whatsapp verify: {0}' -f $r.StatusCode)

Write-Host ''
Write-Host '=== S2-NOTIF: Health sub-endpoints ==='

$r = Invoke-Api -Method Get -Url ('{0}/health/database' -f $notifBase)
Test-Result -Label '/health/database' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/health/rabbitmq' -f $notifBase)
Test-Result -Label '/health/rabbitmq' -Status $r.StatusCode

$r = Invoke-Api -Method Get -Url ('{0}/internal/urgent-alert-config?village_id={1}' -f $notifBase, $VillageId)
Test-Result -Label '/internal/urgent-alert-config' -Status $r.StatusCode

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
