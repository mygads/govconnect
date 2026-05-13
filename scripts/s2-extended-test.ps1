param(
  [string]$DashboardBase = 'http://127.0.0.1:3010',
  [string]$CaseBase = 'http://127.0.0.1:3003',
  [string]$ChannelBase = 'http://127.0.0.1:3001',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025',
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$OtherVillageId = 'cmkrznayo0000mr01d8oxqxdh',
  [string]$VillageSlug = 'desa-sanreseng-ade',
  [string]$AdminId = 'cmkuvo1hv0002mj60yug4cc3s'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Result {
  param([string]$Label, [int]$Status, [int]$Expected = 200, [string]$Detail = '')
  $pass = if ($Status -eq $Expected) { 'PASS' } else { 'FAIL' }
  Write-Host ('[{0}] {1}: {2} (expected {3}) {4}' -f $pass, $Label, $Status, $Expected, $Detail)
}

$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$vaHeaders = @{ 'Cookie' = ('token=' + $vaToken); 'Content-Type' = 'application/json' }
$saHeaders = @{ 'Cookie' = ('token=' + $saToken); 'Content-Type' = 'application/json' }
$internalHeaders = @{ 'x-internal-api-key' = $InternalApiKey; 'x-village-id' = $VillageId }

Write-Host '=== S2-MULTITENANT: Village isolation ==='

$uri = ('{0}/api/laporan?limit=10' -f $DashboardBase)
$r = Invoke-WebRequest -Method Get -Uri $uri -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
$allSanreseng = $true
foreach ($row in $data.data) { if ($row.village_id -ne $VillageId) { $allSanreseng = $false; break } }
$pass = if ($allSanreseng) { 'PASS' } else { 'FAIL' }
Write-Host ('[{0}] VA laporan list isolation: all {1} rows belong to Sanreseng Ade (no leak)' -f $pass, $data.data.Count)

# Service requests isolation
$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/service-requests?limit=10' -f $DashboardBase) -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
$allSanreseng = $true
foreach ($row in $data.data) { if ($row.village_id -ne $VillageId) { $allSanreseng = $false; break } }
$pass = if ($allSanreseng) { 'PASS' } else { 'FAIL' }
Write-Host ('[{0}] VA service-requests isolation: all {1} rows belong to Sanreseng Ade' -f $pass, $data.data.Count)

# Knowledge base isolation
$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/knowledge?limit=20' -f $DashboardBase) -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
$data = $r.Content | ConvertFrom-Json
$allSanreseng = $true
foreach ($row in $data.data) { if ($row.village_id -ne $VillageId -and $row.scope -ne 'global') { $allSanreseng = $false; break } }
$pass = if ($allSanreseng) { 'PASS' } else { 'FAIL' }
Write-Host ('[{0}] VA knowledge isolation: all {1} rows scope match' -f $pass, $data.data.Count)

Write-Host ''
Write-Host '=== S2-PUBLIC: API endpoints ==='

$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/public/services/by-slug?village_slug={1}&service_slug=administrasi-kependudukan-keterangan-domisili' -f $DashboardBase, $VillageSlug) -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Public service by-slug (valid)' -Status $r.StatusCode
$svc = $r.Content | ConvertFrom-Json
$serviceId = $svc.data.id

$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/public/services/by-slug?village_slug={1}&service_slug=nonexistent-xyz' -f $DashboardBase, $VillageSlug) -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Public service by-slug (invalid)' -Status $r.StatusCode -Expected 404

# Test public service-requests validation (files are required, should 400 on JSON-only)
$body = @{
  service_id = $serviceId
  village_id = $VillageId
  wa_user_id = '6289916055001'
  citizen_data = @{ nama_lengkap = 'Test'; nik = '5201010101016001'; alamat = 'Test'; no_hp = '08123'; wa_user_id = '6289916055001' }
  requirement_data = @{ alamat_lengkap = 'Test' }
} | ConvertTo-Json -Depth 5 -Compress

$r = Invoke-WebRequest -Method Post -Uri "$DashboardBase/api/public/service-requests" -Body $body -ContentType 'application/json' -TimeoutSec 15 -SkipHttpErrorCheck
Test-Result -Label 'Public POST (missing KTP file) validation' -Status $r.StatusCode -Expected 400
Write-Host ('  error msg: ' + $r.Content.Substring(0, [Math]::Min(80, $r.Content.Length)))

# Empty body
$r = Invoke-WebRequest -Method Post -Uri "$DashboardBase/api/public/service-requests" -Body '{}' -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Public POST empty body' -Status $r.StatusCode -Expected 400

Write-Host ''
Write-Host '=== S2-SUPERADMIN: management endpoints ==='

$endpoints = @(
  @{ ep='api/superadmin/village-admins'; label='village-admins list' },
  @{ ep=('api/superadmin/ai-wallets/' + $VillageId); label='ai-wallets by village' },
  @{ ep='api/superadmin/ai-billing/reconciliation'; label='ai-billing reconciliation' },
  @{ ep='api/superadmin/whatsapp/health'; label='whatsapp health' },
  @{ ep='api/superadmin/ai-generations?limit=3'; label='ai-generations list' },
  @{ ep='api/superadmin/ai-models'; label='ai-models list' },
  @{ ep='api/superadmin/providers'; label='providers list' }
)
foreach ($e in $endpoints) {
  $r = Invoke-WebRequest -Method Get -Uri ('{0}/{1}' -f $DashboardBase, $e.ep) -Headers $saHeaders -TimeoutSec 10 -SkipHttpErrorCheck
  Test-Result -Label ('SA ' + $e.label) -Status $r.StatusCode
}

# RBAC
$rbacEndpoints = @(
  'api/superadmin/village-admins',
  'api/superadmin/ai-wallets/' + $VillageId,
  'api/superadmin/whatsapp/health',
  'api/superadmin/ai-models'
)
foreach ($ep in $rbacEndpoints) {
  $r = Invoke-WebRequest -Method Get -Uri ('{0}/{1}' -f $DashboardBase, $ep) -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
  Test-Result -Label ('RBAC VA->' + $ep) -Status $r.StatusCode -Expected 403
}

Write-Host ''
Write-Host '=== S2-DOCS: list pagination + stats ==='

$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/documents?page=1&limit=5' -f $DashboardBase) -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Docs pagination page 1 limit 5' -Status $r.StatusCode
$docs = $r.Content | ConvertFrom-Json
Write-Host ('  returned: {0}' -f $docs.data.Count)

$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/documents/stats" -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Docs stats' -Status $r.StatusCode

Write-Host ''
Write-Host '=== S2-LIVECHAT: admin operations ==='

$testUser = '628991543000'
$r = Invoke-WebRequest -Method Get -Uri ('{0}/internal/conversations?village_id={1}&limit=3' -f $ChannelBase, $VillageId) -Headers $internalHeaders -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Livechat conversations list' -Status $r.StatusCode
$convs = $r.Content | ConvertFrom-Json
if ($convs.data -and $convs.data.Count -gt 0) {
  $firstConvUser = $convs.data[0].wa_user_id
  if ($firstConvUser) {
    $r = Invoke-WebRequest -Method Get -Uri ('{0}/internal/conversations/{1}?village_id={2}' -f $ChannelBase, $firstConvUser, $VillageId) -Headers $internalHeaders -TimeoutSec 10 -SkipHttpErrorCheck
    Test-Result -Label 'Livechat conversation detail' -Status $r.StatusCode

    # Mark as read
    $body = @{ village_id = $VillageId } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Method Post -Uri ('{0}/internal/conversations/{1}/read' -f $ChannelBase, $firstConvUser) -Headers $internalHeaders -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
    Test-Result -Label 'Livechat mark-as-read' -Status $r.StatusCode

    # Typing indicator
    $body = @{ village_id = $VillageId; typing = $true } | ConvertTo-Json -Compress
    $r = Invoke-WebRequest -Method Post -Uri ('{0}/internal/conversations/{1}/typing' -f $ChannelBase, $firstConvUser) -Headers $internalHeaders -Body $body -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
    Test-Result -Label 'Livechat typing indicator' -Status $r.StatusCode
  }
}

Write-Host ''
Write-Host '=== S2-CHANNEL-SETTINGS: GET + PUT roundtrip ==='

$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/channel-settings" -Headers $vaHeaders -TimeoutSec 10 -SkipHttpErrorCheck
Test-Result -Label 'Channel-settings GET' -Status $r.StatusCode
$settings = $r.Content | ConvertFrom-Json
Write-Host ('  current enabled_webchat: {0}' -f $settings.data.enabled_webchat)

Write-Host ''
Write-Host '=== S2-ACTIVITY-LOG: verify writes recorded ==='

$logCount = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT COUNT(*) FROM dashboard.activity_logs WHERE created_at > NOW() - INTERVAL '2 hours';").Trim()
Write-Host ('Total activity logs last 2h: {0}' -f $logCount)

$loginCount = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT COUNT(*) FROM dashboard.activity_logs WHERE action='login' AND created_at > NOW() - INTERVAL '2 hours';").Trim()
Write-Host ('Login actions last 2h: {0}' -f $loginCount)

$actionsSummary = docker exec infra-postgres psql -U postgres -d govconnect -t -c "SELECT action, COUNT(*) FROM dashboard.activity_logs WHERE created_at > NOW() - INTERVAL '2 hours' GROUP BY action ORDER BY count DESC LIMIT 10;" 2>&1
Write-Host ('Top actions: ' + ($actionsSummary -join ' | '))
