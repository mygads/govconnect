Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DashboardBase = 'http://127.0.0.1:3010'
$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saHeaders = @{ 'Cookie' = ('token=' + $saToken) }
$vaHeaders = @{ 'Cookie' = ('token=' + $vaToken) }
$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w'

$script:pass = 0
$script:fail = 0

function Test-Get {
  param([string]$Label, [string]$Url, [hashtable]$Headers, [int]$Expected = 200)
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -Headers $Headers -TimeoutSec 10 -SkipHttpErrorCheck
    $ok = $r.StatusCode -eq $Expected
    if ($ok) {
      $script:pass++
      $preview = $r.Content.Substring(0, [Math]::Min(80, $r.Content.Length))
      Write-Host ('[PASS] {0}: {1} | {2}' -f $Label, $r.StatusCode, $preview)
    } else {
      $script:fail++
      $preview = $r.Content.Substring(0, [Math]::Min(100, $r.Content.Length))
      Write-Host ('[FAIL] {0}: {1} (expected {2}) | {3}' -f $Label, $r.StatusCode, $Expected, $preview)
    }
  } catch {
    $script:fail++
    Write-Host ('[ERROR] {0}: {1}' -f $Label, $_.Exception.Message)
  }
}

Write-Host '=== VA: AI-usage by valid slug ==='
$aiSlugs = @('summary', 'by-period', 'by-period-layer', 'by-model', 'by-provider', 'layer-breakdown', 'avg-per-chat')
foreach ($slug in $aiSlugs) {
  Test-Get -Label ('VA /api/ai-usage/' + $slug) -Url ("$DashboardBase/api/ai-usage/$slug") -Headers $vaHeaders
}

Write-Host ''
Write-Host '=== SA: statistics by slug + export with village_id ==='
Test-Get -Label 'SA /api/statistics/ai-usage/summary' -Url "$DashboardBase/api/statistics/ai-usage/summary" -Headers $saHeaders
Test-Get -Label ('SA /api/statistics/knowledge-analytics/export?village_id=' + $VillageId) -Url "$DashboardBase/api/statistics/knowledge-analytics/export?village_id=$VillageId" -Headers $saHeaders

Write-Host ''
Write-Host '=== VA: Statistics token-usage by valid slug ==='
$tokenSlugs = @('summary', 'by-period', 'by-model', 'by-provider')
foreach ($slug in $tokenSlugs) {
  Test-Get -Label ('VA /api/statistics/token-usage/' + $slug) -Url "$DashboardBase/api/statistics/token-usage/$slug" -Headers $vaHeaders
}

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
