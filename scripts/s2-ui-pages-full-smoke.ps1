param(
  [string]$DashboardBase = 'http://127.0.0.1:3010',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025',
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$VillageSlug = 'desa-sanreseng-ade'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$script:pass = 0
$script:fail = 0
$script:failed = @()

function Test-Page {
  param([string]$Label, [string]$Url, [string]$Token = '', [int]$Expected = 200)
  $hdrs = @{}
  if ($Token) { $hdrs['Cookie'] = ('token=' + $Token) }
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -Headers $hdrs -TimeoutSec 15 -SkipHttpErrorCheck
    $ok = $r.StatusCode -eq $Expected
    $hasHtml = $r.Content -like '*<html*' -or $r.Content -like '*<!DOCTYPE*' -or $r.Content -like '*__next*'
    if ($ok) {
      $script:pass++
      Write-Host ('[PASS] {0}: {1} html={2}' -f $Label, $r.StatusCode, $hasHtml)
    } else {
      $script:fail++
      $script:failed += ('{0} ({1} expected {2})' -f $Label, $r.StatusCode, $Expected)
      Write-Host ('[FAIL] {0}: {1} (expected {2}) html={3}' -f $Label, $r.StatusCode, $Expected, $hasHtml)
    }
  } catch {
    $script:fail++
    $script:failed += ('{0} (EXCEPTION: {1})' -f $Label, $_.Exception.Message)
    Write-Host ('[ERROR] {0}: {1}' -f $Label, $_.Exception.Message)
  }
}

Write-Host '=== PUBLIC PAGES (no auth) ==='
Test-Page -Label '/' -Url "$DashboardBase/"
Test-Page -Label '/register' -Url "$DashboardBase/register"
Test-Page -Label '/form' -Url "$DashboardBase/form"
Test-Page -Label ('/form/{0}/administrasi-kependudukan-keterangan-domisili' -f $VillageSlug) -Url ('{0}/form/{1}/administrasi-kependudukan-keterangan-domisili' -f $DashboardBase, $VillageSlug)

Write-Host ''
Write-Host '=== VA DASHBOARD PAGES (auth village_admin) ==='
$vaPages = @(
  'dashboard/ai-balance',
  'dashboard/pelayanan',
  'dashboard/village-profile',
  'dashboard/statistik',
  'dashboard/statistik/analytics',
  'dashboard/knowledge',
  'dashboard/knowledge-analytics',
  'dashboard/important-contacts',
  'dashboard/channel-settings',
  'dashboard/pengaduan/kategori-jenis',
  'dashboard/ai-usage',
  'dashboard/testing-knowledge',
  'dashboard/settings',
  'dashboard/settings/notifications',
  'dashboard/settings/cache',
  'dashboard/settings/rate-limit'
)
foreach ($p in $vaPages) {
  Test-Page -Label ('VA /' + $p) -Url ('{0}/{1}' -f $DashboardBase, $p) -Token $vaToken
}

Write-Host ''
Write-Host '=== SA SUPERADMIN PAGES (auth superadmin) ==='
$saPages = @(
  'dashboard/superadmin/village-admins',
  'dashboard/superadmin/providers',
  'dashboard/superadmin/providers/models',
  'dashboard/superadmin/providers/assignments',
  'dashboard/superadmin/whatsapp',
  'dashboard/superadmin/ai-wallets',
  'dashboard/superadmin/ai-usage',
  'dashboard/superadmin/ai-generations',
  'dashboard/superadmin/ai-billing-reconciliation',
  'dashboard/superadmin/llm-check',
  'dashboard/superadmin/register'
)
foreach ($p in $saPages) {
  Test-Page -Label ('SA /' + $p) -Url ('{0}/{1}' -f $DashboardBase, $p) -Token $saToken
}

Write-Host ''
Write-Host '=== DYNAMIC PAGE TESTS (with valid IDs) ==='

# Get an actual complaint ID to test /dashboard/laporan/[id]
$firstLap = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.complaints WHERE village_id='$VillageId' LIMIT 1;").Trim()
if ($firstLap) {
  Test-Page -Label ('VA /dashboard/laporan/' + $firstLap.Substring(0,8)) -Url ('{0}/dashboard/laporan/{1}' -f $DashboardBase, $firstLap) -Token $vaToken
}

# Get a service ID
$firstSvc = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.services_dynamic WHERE village_id='$VillageId' AND is_active=true LIMIT 1;").Trim()
if ($firstSvc) {
  Test-Page -Label ('VA /dashboard/pelayanan/' + $firstSvc.Substring(0,8)) -Url ('{0}/dashboard/pelayanan/{1}' -f $DashboardBase, $firstSvc) -Token $vaToken
}

# SA village detail
Test-Page -Label ('SA /dashboard/superadmin/villages/' + $VillageId.Substring(0,8)) -Url ('{0}/dashboard/superadmin/villages/{1}' -f $DashboardBase, $VillageId) -Token $saToken

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
if ($script:failed.Count -gt 0) {
  Write-Host 'Failures:'
  foreach ($f in $script:failed) { Write-Host ('  - ' + $f) }
}
