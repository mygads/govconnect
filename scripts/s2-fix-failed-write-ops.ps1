Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CaseBase = 'http://127.0.0.1:3003'
$ChannelBase = 'http://127.0.0.1:3001'
$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w'
$InternalKey = 'govconnect-internal-api-key-2025'

$headers = @{ 'x-internal-api-key' = $InternalKey; 'x-village-id' = $VillageId; 'x-admin-role' = 'village_admin'; 'Content-Type' = 'application/json' }

$script:pass = 0
$script:fail = 0

function Test-Api {
  param([string]$Label, [string]$Method, [string]$Url, [hashtable]$Headers, $Body = $null, [int]$Expected = 200, [int]$Timeout = 15)
  $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = $Timeout; SkipHttpErrorCheck = $true }
  if ($Body) { $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 -Compress } }
  $r = Invoke-WebRequest @params
  $ok = $r.StatusCode -eq $Expected
  if ($ok) {
    $script:pass++
    Write-Host ('[PASS] {0}: {1}' -f $Label, $r.StatusCode)
  } else {
    $script:fail++
    $preview = $r.Content.Substring(0, [Math]::Min(120, $r.Content.Length))
    Write-Host ('[FAIL] {0}: {1} (expected {2}) | {3}' -f $Label, $r.StatusCode, $Expected, $preview)
  }
  $r | Out-Null
  return $r
}

Write-Host '=== Fix 1: Complaint user-update with matching wa_user_id ==='

# Get an OPEN complaint and its wa_user_id
$complaintRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -F '|' -c "SELECT id, wa_user_id FROM cases.complaints WHERE village_id='$VillageId' AND status='OPEN' AND wa_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;"
$parts = $complaintRow.Trim() -split '\|'
if ($parts.Length -ge 2) {
  $lapId = $parts[0]
  $waUser = $parts[1]
  Write-Host ('  using complaint id={0} wa_user_id={1}' -f $lapId, $waUser)
  $body = @{ wa_user_id = $waUser; deskripsi = ('s2_user_update ' + (Get-Date -Format 'HH:mm:ss')) }
  Test-Api -Label 'CASE PATCH /laporan/[id]/update (user wa_user match)' -Method Patch -Url "$CaseBase/laporan/$lapId/update?village_id=$VillageId" -Headers $headers -Body $body
} else {
  Write-Host '  No OPEN complaint with wa_user_id — skipping'
}

Write-Host ''
Write-Host '=== Fix 2: Edit-token with wa_user_id ==='

$layRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -F '|' -c "SELECT id, wa_user_id FROM cases.service_requests WHERE village_id='$VillageId' AND status='PROCESS' AND wa_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;"
$layParts = $layRow.Trim() -split '\|'
if ($layParts.Length -ge 2) {
  $layId = $layParts[0]
  $layWaUser = $layParts[1]
  Write-Host ('  using service request id={0} wa_user_id={1}' -f $layId, $layWaUser)
  $body = @{ wa_user_id = $layWaUser }
  $r = Test-Api -Label 'CASE POST /service-requests/[id]/edit-token' -Method Post -Url "$CaseBase/service-requests/$layId/edit-token?village_id=$VillageId" -Headers $headers -Body $body
  $data = $r.Content | ConvertFrom-Json
  $editToken = ''
  if ($data -and $data.PSObject.Properties.Name -contains 'data') {
    $editToken = $data.data.edit_token
    Write-Host ('  edit_token obtained: {0}...' -f $editToken.Substring(0, [Math]::Min(30, $editToken.Length)))

    # Get by token (no auth)
    Test-Api -Label 'CASE GET /service-requests/by-token' -Method Get -Url "$CaseBase/service-requests/by-token?token=$editToken" -Headers @{}

    # PATCH by-token
    $patchBody = @{ edit_token = $editToken; citizen_data_json = @{ nama_lengkap = 's2_edited_' + (Get-Date -Format 'HHmmss') } }
    Test-Api -Label 'CASE PATCH /service-requests/[id]/by-token' -Method Patch -Url "$CaseBase/service-requests/$layId/by-token" -Headers @{ 'Content-Type' = 'application/json' } -Body $patchBody
  }
} else {
  Write-Host '  No PROCESS service request with wa_user_id — skipping'
}

Write-Host ''
Write-Host '=== Fix 3: Channel admin send (retry with complete body) ==='

# Find a real wa_user from existing conversations
$waUserRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT wa_user_id FROM channel.conversations WHERE village_id='$VillageId' AND wa_user_id IS NOT NULL LIMIT 1;"
$waUser = $waUserRow.Trim()
if ($waUser) {
  Write-Host ('  test wa_user: {0}' -f $waUser)
  $sendBody = @{
    village_id = $VillageId
    message = @{ text = 's2_admin_send_test ' + (Get-Date -Format 'HH:mm:ss') }
    admin_id = 'cmkuvo1hv0002mj60yug4cc3s'
    admin_name = 'S2 Regression Admin'
  }
  $r = Test-Api -Label 'CHANNEL POST /internal/conversations/[wa_user_id]/send' -Method Post -Url "$ChannelBase/internal/conversations/$waUser/send" -Headers $headers -Body $sendBody
  if ($r.StatusCode -ne 200) {
    Write-Host ('  detail: ' + $r.Content.Substring(0, [Math]::Min(300, $r.Content.Length)))
  }
}

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
