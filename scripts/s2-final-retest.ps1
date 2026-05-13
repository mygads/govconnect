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
  return $r
}

Write-Host '=== Final fix 1: by-token GET with wa= query ==='

$layRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -F '|' -c "SELECT id, wa_user_id FROM cases.service_requests WHERE village_id='$VillageId' AND status='PROCESS' AND wa_user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;"
$layParts = $layRow.Trim() -split '\|'
$layId = $layParts[0]
$layWaUser = $layParts[1]

# Get fresh edit-token
$r = Test-Api -Label 'Generate fresh edit-token' -Method Post -Url "$CaseBase/service-requests/$layId/edit-token?village_id=$VillageId" -Headers $headers -Body @{ wa_user_id = $layWaUser }
$data = $r.Content | ConvertFrom-Json
$editToken = $data.data.edit_token

# GET with wa= query param
Test-Api -Label 'CASE GET /service-requests/by-token?token=...&wa=' -Method Get -Url ("$CaseBase/service-requests/by-token?token=$editToken" + "&wa=" + $layWaUser) -Headers @{}

# PATCH with wa= query param
$patchBody = @{ edit_token = $editToken; citizen_data_json = @{ nama_lengkap = 's2_edited' } }
Test-Api -Label 'CASE PATCH /service-requests/[id]/by-token with wa query' -Method Patch -Url ("$CaseBase/service-requests/$layId/by-token?wa=" + $layWaUser) -Headers @{ 'Content-Type' = 'application/json' } -Body $patchBody

Write-Host ''
Write-Host '=== Final fix 2: Channel admin send with message as string ==='

$waUserRow = docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT wa_user_id FROM channel.conversations WHERE village_id='$VillageId' AND wa_user_id IS NOT NULL LIMIT 1;"
$waUser = $waUserRow.Trim()

$sendBody = @{
  village_id = $VillageId
  message = ('s2_admin_send_test ' + (Get-Date -Format 'HH:mm:ss'))
  admin_id = 'cmkuvo1hv0002mj60yug4cc3s'
  admin_name = 'S2 Regression Admin'
}
Test-Api -Label 'CHANNEL POST /internal/conversations/[wa_user_id]/send (msg as string)' -Method Post -Url "$ChannelBase/internal/conversations/$waUser/send" -Headers $headers -Body $sendBody

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
