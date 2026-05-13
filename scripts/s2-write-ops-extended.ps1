Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DashboardBase = 'http://127.0.0.1:3010'
$CaseBase = 'http://127.0.0.1:3003'
$ChannelBase = 'http://127.0.0.1:3001'
$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w'
$InternalKey = 'govconnect-internal-api-key-2025'

$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$saHeaders = @{ 'Cookie' = ('token=' + $saToken); 'Content-Type' = 'application/json' }
$vaHeaders = @{ 'Cookie' = ('token=' + $vaToken); 'Content-Type' = 'application/json' }
$internalHeaders = @{ 'x-internal-api-key' = $InternalKey; 'x-village-id' = $VillageId; 'x-admin-role' = 'village_admin' }
$internalCtHeaders = @{ 'x-internal-api-key' = $InternalKey; 'x-village-id' = $VillageId; 'x-admin-role' = 'village_admin'; 'Content-Type' = 'application/json' }

$script:pass = 0
$script:fail = 0
$script:failed = @()

function Test-Api {
  param(
    [string]$Label,
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    $Body = $null,
    [int]$Expected = 200,
    [int]$Timeout = 15
  )
  $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = $Timeout; SkipHttpErrorCheck = $true }
  if ($Body) {
    $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 -Compress }
  }
  try {
    $r = Invoke-WebRequest @params
    $ok = $r.StatusCode -eq $Expected
    if ($ok) {
      $script:pass++
      Write-Host ('[PASS] {0}: {1}' -f $Label, $r.StatusCode)
    } else {
      $script:fail++
      $script:failed += ('{0} ({1} expected {2})' -f $Label, $r.StatusCode, $Expected)
      $preview = $r.Content.Substring(0, [Math]::Min(150, $r.Content.Length))
      Write-Host ('[FAIL] {0}: {1} (expected {2}) | {3}' -f $Label, $r.StatusCode, $Expected, $preview)
    }
    return $r
  } catch {
    $script:fail++
    $script:failed += ('{0} (EXCEPTION: {1})' -f $Label, $_.Exception.Message)
    Write-Host ('[ERROR] {0}: {1}' -f $Label, $_.Exception.Message)
    return $null
  }
}

Write-Host '=== 1. SA: Village admin CRUD roundtrip ==='

$newUsername = 's2_testadmin_' + (Get-Date -Format 'HHmmssfff')
$createBody = @{
  village_id = $VillageId
  username = $newUsername
  password = 'S2Test!2026Strong'
  name = 'S2 Test Village Admin'
  role = 'village_admin'
}
$r = Test-Api -Label 'SA POST /api/superadmin/village-admins' -Method Post -Url "$DashboardBase/api/superadmin/village-admins" -Headers $saHeaders -Body $createBody -Expected 201
$createdVa = $r.Content | ConvertFrom-Json
$newVaId = $null
if ($createdVa.data) { $newVaId = $createdVa.data.id }
Write-Host ('  created VA id: {0}' -f $newVaId)

if ($newVaId) {
  Test-Api -Label 'SA PUT /api/superadmin/village-admins/[id]' -Method Put -Url "$DashboardBase/api/superadmin/village-admins/$newVaId" -Headers $saHeaders -Body @{ name = 'Updated S2 Test Name' }
  Test-Api -Label 'SA POST reset-password' -Method Post -Url "$DashboardBase/api/superadmin/village-admins/$newVaId/reset-password" -Headers $saHeaders -Body @{ new_password = 'NewPassword!2026' }
  Test-Api -Label 'SA DELETE /api/superadmin/village-admins/[id]' -Method Delete -Url "$DashboardBase/api/superadmin/village-admins/$newVaId" -Headers $saHeaders
}

Write-Host ''
Write-Host '=== 2. SA: AI wallet adjust + topup (small amounts) ==='

$adjustBody = @{ amount_usd = 0.01; direction = 'credit'; reason = 's2_test_adjust_small' }
Test-Api -Label 'SA POST ai-wallets/[id]/adjust' -Method Post -Url "$DashboardBase/api/superadmin/ai-wallets/$VillageId/adjust" -Headers $saHeaders -Body $adjustBody

$topupBody = @{ amount_usd = 0.01; entry_type = 'topup' }
Test-Api -Label 'SA POST ai-wallets/[id]/topup' -Method Post -Url "$DashboardBase/api/superadmin/ai-wallets/$VillageId/topup" -Headers $saHeaders -Body $topupBody

# Revert with debit
$revertBody = @{ amount_usd = 0.02; direction = 'debit'; reason = 's2_test_revert' }
Test-Api -Label 'SA POST ai-wallets/[id]/adjust (revert)' -Method Post -Url "$DashboardBase/api/superadmin/ai-wallets/$VillageId/adjust" -Headers $saHeaders -Body $revertBody

Write-Host ''
Write-Host '=== 3. VA: Important contacts PATCH ==='

# Get an existing contact
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/important-contacts" -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
$contacts = ($r.Content | ConvertFrom-Json).data
$firstContact = $contacts | Where-Object { $_.name -like '*test*' -or $_.name -like '*S2*' } | Select-Object -First 1
if (-not $firstContact) {
  # Create a test contact first
  $categoryId = $contacts[0].category_id
  $createContact = @{ name = 's2_test_contact_PATCH'; phone = '+62 812-0000-0001'; description = 's2 patch test'; category_id = $categoryId }
  $r = Invoke-WebRequest -Method Post -Uri "$DashboardBase/api/important-contacts" -Headers $vaHeaders -Body ($createContact | ConvertTo-Json -Compress) -TimeoutSec 10 -SkipHttpErrorCheck
  $firstContact = ($r.Content | ConvertFrom-Json).data
}
$contactId = $firstContact.id
Write-Host ('  test contact id: {0}' -f $contactId)

$updateBody = @{ name = 's2_test_contact_UPDATED'; phone = '+62 812-9999-9999'; description = 's2 patched' }
Test-Api -Label 'VA PATCH /api/important-contacts/[id]' -Method Patch -Url "$DashboardBase/api/important-contacts/$contactId" -Headers $vaHeaders -Body $updateBody

Test-Api -Label 'VA DELETE /api/important-contacts/[id]' -Method Delete -Url "$DashboardBase/api/important-contacts/$contactId" -Headers $vaHeaders

Write-Host ''
Write-Host '=== 4. VA: Testing knowledge POST ==='

$tkBody = @{ query = 'Apa alamat kantor desa Sanreseng Ade?' }
Test-Api -Label 'VA POST /api/testing-knowledge' -Method Post -Url "$DashboardBase/api/testing-knowledge" -Headers $vaHeaders -Body $tkBody -Timeout 30

Test-Api -Label 'VA POST /api/testing-knowledge/reset' -Method Post -Url "$DashboardBase/api/testing-knowledge/reset" -Headers $vaHeaders -Body @{}

Write-Host ''
Write-Host '=== 5. VA: Knowledge gaps PATCH ==='

$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/knowledge/gaps" -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
$gaps = ($r.Content | ConvertFrom-Json).data
if ($gaps -and $gaps.Count -gt 0) {
  $gapId = $gaps[0].id
  Write-Host ('  first gap id: {0}' -f $gapId)
  Test-Api -Label 'VA PATCH /api/knowledge-gaps/[id]' -Method Patch -Url "$DashboardBase/api/knowledge-gaps/$gapId" -Headers $vaHeaders -Body @{ status = 'ignored' }
  # revert
  Test-Api -Label 'VA PATCH /api/knowledge-gaps/[id] revert' -Method Patch -Url "$DashboardBase/api/knowledge-gaps/$gapId" -Headers $vaHeaders -Body @{ status = 'open' }
} else {
  Write-Host '  no knowledge gaps — skipping'
}

Write-Host ''
Write-Host '=== 6. SA: AI model test ==='

$testModelBody = @{ model_id = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM ai.ai_models WHERE is_active=true LIMIT 1;").Trim() }
Test-Api -Label 'SA POST /api/superadmin/ai-models/test' -Method Post -Url "$DashboardBase/api/superadmin/ai-models/test" -Headers $saHeaders -Body $testModelBody -Timeout 30

Write-Host ''
Write-Host '=== 7. Case service: Complaint update by user (safe PATCH) ==='

$openLapId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.complaints WHERE village_id='$VillageId' AND status='OPEN' ORDER BY created_at DESC LIMIT 1;").Trim()
if ($openLapId) {
  $updateBody = @{ deskripsi = ('s2_test update via case-service API ' + (Get-Date -Format 'HH:mm:ss')) }
  Test-Api -Label ('CASE PATCH /laporan/' + $openLapId.Substring(0,8) + '/update') -Method Patch -Url "$CaseBase/laporan/$openLapId/update?village_id=$VillageId" -Headers $internalCtHeaders -Body $updateBody
}

Write-Host ''
Write-Host '=== 8. Case service: Service request edit-token flow ==='

$openLayId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.service_requests WHERE village_id='$VillageId' AND status='PROCESS' ORDER BY created_at DESC LIMIT 1;").Trim()
if ($openLayId) {
  $r = Test-Api -Label ('CASE POST /service-requests/' + $openLayId.Substring(0,8) + '/edit-token') -Method Post -Url "$CaseBase/service-requests/$openLayId/edit-token?village_id=$VillageId" -Headers $internalCtHeaders -Body @{}
  if ($r) {
    $data = $r.Content | ConvertFrom-Json
    $editToken = if ($data.data) { $data.data.edit_token } else { '' }
    Write-Host ('  edit_token: {0}' -f ($editToken.Substring(0,[Math]::Min(20,$editToken.Length)) + '...'))

    # Get by token (no auth needed)
    $r2 = Invoke-WebRequest -Method Get -Uri "$CaseBase/service-requests/by-token?token=$editToken" -TimeoutSec 10 -SkipHttpErrorCheck
    Test-Api -Label 'CASE GET /service-requests/by-token' -Method Get -Url "$CaseBase/service-requests/by-token?token=$editToken" -Headers @{}
  }
}

Write-Host ''
Write-Host '=== 9. Channel service: Admin send + retry ==='

$testWaUser = '6289899900001'
$sendBody = @{
  message = @{ text = 's2_test admin message from regression' }
  admin_id = 'cmkuvo1hv0002mj60yug4cc3s'
  admin_name = 'S2 Regression Admin'
  village_id = $VillageId
}
Test-Api -Label 'CHANNEL POST /internal/conversations/[wa_user_id]/send' -Method Post -Url "$ChannelBase/internal/conversations/$testWaUser/send" -Headers $internalCtHeaders -Body $sendBody

# Retry (may fail if no recent message to retry)
Test-Api -Label 'CHANNEL POST /internal/conversations/[wa_user_id]/retry' -Method Post -Url "$ChannelBase/internal/conversations/$testWaUser/retry" -Headers $internalCtHeaders -Body @{ village_id = $VillageId } -Expected 200

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
if ($script:failed.Count -gt 0) {
  Write-Host 'Failures:'
  foreach ($f in $script:failed) { Write-Host ('  - ' + $f) }
}
