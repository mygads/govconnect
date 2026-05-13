Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DashboardBase = 'http://127.0.0.1:3010'
$CaseBase = 'http://127.0.0.1:3003'
$NotifBase = 'http://127.0.0.1:3004'
$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w'
$InternalKey = 'govconnect-internal-api-key-2025'

$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$vaH = @{ 'Cookie' = ('token=' + $vaToken); 'Content-Type' = 'application/json' }
$saH = @{ 'Cookie' = ('token=' + $saToken); 'Content-Type' = 'application/json' }
$internalH = @{ 'x-internal-api-key' = $InternalKey; 'x-village-id' = $VillageId; 'x-admin-role' = 'village_admin'; 'Content-Type' = 'application/json' }

$script:pass = 0; $script:fail = 0; $script:failed = @()

function Test-Api {
  param([string]$Label, [string]$Method, [string]$Url, [hashtable]$Headers, $Body = $null, [int]$Expected = 200)
  $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = 15; SkipHttpErrorCheck = $true }
  if ($Body) { $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 -Compress } }
  $r = Invoke-WebRequest @params
  $ok = $r.StatusCode -eq $Expected
  if ($ok) { $script:pass++; Write-Host ('[PASS] {0}: {1}' -f $Label, $r.StatusCode) }
  else {
    $script:fail++; $script:failed += ('{0} ({1} expected {2})' -f $Label, $r.StatusCode, $Expected)
    Write-Host ('[FAIL] {0}: {1} (expected {2}) | {3}' -f $Label, $r.StatusCode, $Expected, $r.Content.Substring(0,[Math]::Min(120,$r.Content.Length)))
  }
  return $r
}

Write-Host '=== 1. Individual resource GET endpoints ==='

# Get IDs from DB
$lapId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.complaints WHERE village_id='$VillageId' LIMIT 1;").Trim()
$layId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.service_requests WHERE village_id='$VillageId' LIMIT 1;").Trim()
$svcId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.services_dynamic WHERE village_id='$VillageId' AND is_active=true LIMIT 1;").Trim()
$docId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM dashboard.knowledge_documents WHERE village_id='$VillageId' AND status='completed' LIMIT 1;").Trim()
$kbId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM dashboard.knowledge_base WHERE village_id='$VillageId' LIMIT 1;").Trim()
$contactId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM dashboard.important_contacts WHERE category_id IN (SELECT id FROM dashboard.important_contact_categories WHERE village_id='$VillageId') LIMIT 1;").Trim()

Write-Host ('  IDs: lap={0} lay={1} svc={2} doc={3} kb={4} contact={5}' -f $lapId.Substring(0,8), $layId.Substring(0,8), $svcId.Substring(0,8), $docId.Substring(0,8), $kbId.Substring(0,8), $contactId.Substring(0,8))

Test-Api -Label 'VA GET /api/laporan/[id]' -Method Get -Url "$DashboardBase/api/laporan/$lapId" -Headers $vaH
Test-Api -Label 'VA GET /api/service-requests/[id]' -Method Get -Url "$DashboardBase/api/service-requests/$layId" -Headers $vaH
Test-Api -Label 'VA GET /api/layanan/[serviceId]' -Method Get -Url "$DashboardBase/api/layanan/$svcId" -Headers $vaH
Test-Api -Label 'VA GET /api/documents/[id]' -Method Get -Url "$DashboardBase/api/documents/$docId" -Headers $vaH
Test-Api -Label 'VA GET /api/knowledge/[id]' -Method Get -Url "$DashboardBase/api/knowledge/$kbId" -Headers $vaH
Test-Api -Label 'VA GET /api/important-contacts/[id]' -Method Get -Url "$DashboardBase/api/important-contacts/$contactId" -Headers $vaH

Write-Host ''
Write-Host '=== 2. Public + utility endpoints ==='

Test-Api -Label 'VA GET /api/layanan/village' -Method Get -Url "$DashboardBase/api/layanan/village" -Headers $vaH
Test-Api -Label 'no-auth GET /api/csrf' -Method Get -Url "$DashboardBase/api/csrf" -Headers @{}
Test-Api -Label 'no-auth GET /api/metrics' -Method Get -Url "$DashboardBase/api/metrics" -Headers @{}

Write-Host ''
Write-Host '=== 3. Document PUT update metadata ==='

# Get current document
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/documents/$docId" -Headers $vaH -TimeoutSec 10 -SkipHttpErrorCheck
$origDoc = ($r.Content | ConvertFrom-Json).data
$origDesc = $origDoc.description
$origTitle = $origDoc.title
Write-Host ('  current title: {0}' -f $origTitle)

Test-Api -Label 'VA PUT /api/documents/[id] (update desc)' -Method Put -Url "$DashboardBase/api/documents/$docId" -Headers $vaH -Body @{ title = $origTitle; description = 's2_test updated desc'; category = $origDoc.category; category_id = $origDoc.category_id }

# Revert
Test-Api -Label 'VA PUT /api/documents/[id] (revert)' -Method Put -Url "$DashboardBase/api/documents/$docId" -Headers $vaH -Body @{ title = $origTitle; description = $origDesc; category = $origDoc.category; category_id = $origDoc.category_id }

Write-Host ''
Write-Host '=== 4. Case service: complaint + service-request check endpoints ==='

$lapOwnerRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -F '|' -c "SELECT id, wa_user_id FROM cases.complaints WHERE village_id='$VillageId' AND wa_user_id IS NOT NULL LIMIT 1;"
$parts = $lapOwnerRow.Trim() -split '\|'
if ($parts.Length -ge 2) {
  $lapIdChk = $parts[0]
  $lapWaUser = $parts[1]
  Test-Api -Label ('CASE POST /laporan/' + $lapIdChk.Substring(0,8) + '/check') -Method Post -Url "$CaseBase/laporan/$lapIdChk/check?village_id=$VillageId" -Headers $internalH -Body @{ wa_user_id = $lapWaUser }
}

$layOwnerRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -F '|' -c "SELECT id, wa_user_id FROM cases.service_requests WHERE village_id='$VillageId' AND wa_user_id IS NOT NULL LIMIT 1;"
$layParts = $layOwnerRow.Trim() -split '\|'
if ($layParts.Length -ge 2) {
  $layIdChk = $layParts[0]
  $layWaUser = $layParts[1]
  Test-Api -Label ('CASE POST /service-requests/' + $layIdChk.Substring(0,8) + '/check') -Method Post -Url "$CaseBase/service-requests/$layIdChk/check?village_id=$VillageId" -Headers $internalH -Body @{ wa_user_id = $layWaUser }
}

Write-Host ''
Write-Host '=== 5. Notification service: events + delivery-status ==='

# Events: test dengan routingKey yang valid (underscore → dot)
$eventBody = @{
  village_id = $VillageId
  complaint_id = 'TEST-LAP-001'
  status = 'OPEN'
  wa_user_id = '6289999990001'
  test = $true
}
Test-Api -Label 'NOTIF POST /internal/events/status_updated' -Method Post -Url "$NotifBase/internal/events/status_updated" -Headers $internalH -Body $eventBody

# Delivery status
$deliveryBody = @{
  message_id = 'test-msg-id-s2-' + (Get-Date -Format 'HHmmss')
  delivery_status = 'sent'
  occurred_at = (Get-Date).ToString('o')
}
Test-Api -Label 'NOTIF POST /internal/delivery-status' -Method Post -Url "$NotifBase/internal/delivery-status" -Headers $internalH -Body $deliveryBody

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
if ($script:failed.Count -gt 0) {
  Write-Host 'Failures:'
  foreach ($f in $script:failed) { Write-Host ('  - ' + $f) }
}
