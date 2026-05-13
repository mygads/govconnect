param(
  [string]$DashboardBase = 'http://127.0.0.1:3010',
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$VillageSlug = 'desa-sanreseng-ade'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$vaHeaders = @{ 'Cookie' = ('token=' + $vaToken) }
$saHeaders = @{ 'Cookie' = ('token=' + $saToken) }

$script:pass = 0
$script:fail = 0
$script:failed = @()

function Test-Api {
  param([string]$Label, [string]$Url, [hashtable]$Headers, [int]$Expected = 200)
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -Headers $Headers -TimeoutSec 10 -SkipHttpErrorCheck
    $ok = $r.StatusCode -eq $Expected
    if ($ok) {
      $script:pass++
      $preview = $r.Content.Substring(0, [Math]::Min(60, $r.Content.Length))
      Write-Host ('[PASS] {0}: {1} | {2}' -f $Label, $r.StatusCode, $preview)
    } else {
      $script:fail++
      $script:failed += ('{0} ({1} expected {2})' -f $Label, $r.StatusCode, $Expected)
      $preview = $r.Content.Substring(0, [Math]::Min(80, $r.Content.Length))
      Write-Host ('[FAIL] {0}: {1} (expected {2}) | {3}' -f $Label, $r.StatusCode, $Expected, $preview)
    }
  } catch {
    $script:fail++
    $script:failed += ('{0} (EXCEPTION)' -f $Label)
    Write-Host ('[ERROR] {0}: {1}' -f $Label, $_.Exception.Message)
  }
}

Write-Host '=== VA: AI Balance endpoints ==='
Test-Api -Label 'VA /api/ai-balance' -Url "$DashboardBase/api/ai-balance" -Headers $vaHeaders
Test-Api -Label 'VA /api/ai-balance/ledger' -Url "$DashboardBase/api/ai-balance/ledger" -Headers $vaHeaders

Write-Host ''
Write-Host '=== VA: AI Usage endpoints ==='
Test-Api -Label 'VA /api/ai-usage/users' -Url "$DashboardBase/api/ai-usage/users" -Headers $vaHeaders
Test-Api -Label 'VA /api/ai-usage/messages' -Url "$DashboardBase/api/ai-usage/messages?limit=5" -Headers $vaHeaders

Write-Host ''
Write-Host '=== VA: Settings + Cache + Rate-limit + Spam-guard ==='
Test-Api -Label 'VA /api/cache' -Url "$DashboardBase/api/cache" -Headers $vaHeaders
Test-Api -Label 'VA /api/rate-limit' -Url "$DashboardBase/api/rate-limit" -Headers $vaHeaders
Test-Api -Label 'VA /api/rate-limit/blacklist' -Url "$DashboardBase/api/rate-limit/blacklist" -Headers $vaHeaders
Test-Api -Label 'VA /api/spam-guard' -Url "$DashboardBase/api/spam-guard" -Headers $vaHeaders
Test-Api -Label 'VA /api/settings' -Url "$DashboardBase/api/settings" -Headers $vaHeaders
Test-Api -Label 'VA /api/settings/notifications' -Url "$DashboardBase/api/settings/notifications" -Headers $vaHeaders

Write-Host ''
Write-Host '=== VA: Statistics dashboard endpoints ==='
Test-Api -Label 'VA /api/statistics/overview' -Url "$DashboardBase/api/statistics/overview" -Headers $vaHeaders
Test-Api -Label 'VA /api/statistics/trends' -Url "$DashboardBase/api/statistics/trends" -Headers $vaHeaders
Test-Api -Label 'VA /api/statistics/ai-usage' -Url "$DashboardBase/api/statistics/ai-usage" -Headers $vaHeaders
Test-Api -Label 'VA /api/statistics/ai-optimization' -Url "$DashboardBase/api/statistics/ai-optimization" -Headers $vaHeaders
Test-Api -Label 'VA /api/statistics/knowledge-analytics' -Url "$DashboardBase/api/statistics/knowledge-analytics" -Headers $vaHeaders

Write-Host ''
Write-Host '=== SA: Superadmin extended endpoints ==='
Test-Api -Label 'SA /api/superadmin/llm-check' -Url "$DashboardBase/api/superadmin/llm-check" -Headers $saHeaders
Test-Api -Label 'SA /api/superadmin/ai-lane-assignments' -Url "$DashboardBase/api/superadmin/ai-lane-assignments" -Headers $saHeaders

Write-Host ''
Write-Host '=== VA: Knowledge conflicts + gaps ==='
# These endpoints are PATCH/DELETE only; test list availability indirectly via general knowledge API
Test-Api -Label 'VA /api/knowledge-consistency' -Url "$DashboardBase/api/knowledge-consistency" -Headers $vaHeaders
Test-Api -Label 'VA /api/knowledge/gaps' -Url "$DashboardBase/api/knowledge/gaps" -Headers $vaHeaders

Write-Host ''
Write-Host '=== RBAC: VA cannot access SA extended endpoints ==='
Test-Api -Label 'RBAC VA->llm-check' -Url "$DashboardBase/api/superadmin/llm-check" -Headers $vaHeaders -Expected 403
Test-Api -Label 'RBAC VA->ai-lane-assignments' -Url "$DashboardBase/api/superadmin/ai-lane-assignments" -Headers $vaHeaders -Expected 403

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
if ($script:failed.Count -gt 0) {
  Write-Host 'Failures:'
  foreach ($f in $script:failed) { Write-Host ('  - ' + $f) }
}
