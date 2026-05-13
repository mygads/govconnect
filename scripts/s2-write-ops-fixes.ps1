Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DashboardBase = 'http://127.0.0.1:3010'
$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saHeaders = @{ 'Cookie' = ('token=' + $saToken); 'Content-Type' = 'application/json' }
$vaHeaders = @{ 'Cookie' = ('token=' + $vaToken); 'Content-Type' = 'application/json' }

$script:pass = 0
$script:fail = 0

function Test-Endpoint {
  param([string]$Label, [string]$Method, [string]$Url, [hashtable]$Headers, $Body = $null, [int]$Expected = 200, [int]$Timeout = 15)
  $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = $Timeout; SkipHttpErrorCheck = $true }
  if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
  try {
    $r = Invoke-WebRequest @params
    $ok = $r.StatusCode -eq $Expected
    if ($ok) {
      $script:pass++
      Write-Host ('[PASS] {0}: {1}' -f $Label, $r.StatusCode)
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

Write-Host '=== Fix 1: Cache POST with correct action ==='
Test-Endpoint -Label 'SA POST /api/cache clear-all' -Method 'Post' -Url "$DashboardBase/api/cache" -Headers $saHeaders -Body @{ action = 'clear-all' }

Write-Host ''
Write-Host '=== Fix 2: AI-usage slug — try VA instead of SA ==='
Test-Endpoint -Label 'VA /api/ai-usage/desa-sanreseng-ade' -Method 'Get' -Url "$DashboardBase/api/ai-usage/desa-sanreseng-ade" -Headers $vaHeaders

Write-Host ''
Write-Host '=== Fix 3: Statistics token-usage — try VA ==='
Test-Endpoint -Label 'VA /api/statistics/token-usage/desa-sanreseng-ade' -Method 'Get' -Url "$DashboardBase/api/statistics/token-usage/desa-sanreseng-ade" -Headers $vaHeaders

Write-Host ''
Write-Host '=== Fix 4: Knowledge consistency scan with longer timeout ==='
Test-Endpoint -Label 'VA POST /api/knowledge-consistency/scan' -Method 'Post' -Url "$DashboardBase/api/knowledge-consistency/scan" -Headers $vaHeaders -Body @{ village_id = 'cmkuvo1dk0000mj60h4u4bq1w' } -Timeout 60

Write-Host ''
Write-Host '=== Extra: Statistics with slug SA ==='
Test-Endpoint -Label 'SA /api/statistics/ai-usage/poolside-laguna-m.1' -Method 'Get' -Url "$DashboardBase/api/statistics/ai-usage/poolside-laguna-m.1" -Headers $saHeaders
Test-Endpoint -Label 'SA /api/statistics/knowledge-analytics/export' -Method 'Get' -Url "$DashboardBase/api/statistics/knowledge-analytics/export" -Headers $saHeaders

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
