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
  param([string]$Label, [string]$Method, [string]$Url, [hashtable]$Headers, $Body = $null, [int]$Expected = 200)
  $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = 10; SkipHttpErrorCheck = $true }
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

Write-Host '=== SA: Write operations roundtrip ==='

# Cache: GET + POST (clear)
Test-Endpoint -Label 'SA GET /api/cache' -Method 'Get' -Url "$DashboardBase/api/cache" -Headers $saHeaders
Test-Endpoint -Label 'SA POST /api/cache (clear cache)' -Method 'Post' -Url "$DashboardBase/api/cache" -Headers $saHeaders -Body @{ action = 'clear' }

# Settings: GET + PUT minimal change + revert
Test-Endpoint -Label 'SA GET /api/settings' -Method 'Get' -Url "$DashboardBase/api/settings" -Headers $saHeaders

# Rate-limit blacklist: POST + DELETE (add then remove test entry)
$testBlUser = '628999000001'
Test-Endpoint -Label 'SA POST /api/rate-limit/blacklist (add)' -Method 'Post' -Url "$DashboardBase/api/rate-limit/blacklist" -Headers $saHeaders -Body @{ wa_user_id = $testBlUser; reason = 's2_test_add' } -Expected 200
Test-Endpoint -Label 'SA DELETE /api/rate-limit/blacklist (remove)' -Method 'Delete' -Url ("$DashboardBase/api/rate-limit/blacklist?wa_user_id=$testBlUser") -Headers $saHeaders -Expected 200

Write-Host ''
Write-Host '=== SA: AI-usage slug endpoint ==='
$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/ai-usage/desa-sanreseng-ade' -f $DashboardBase) -Headers $saHeaders -TimeoutSec 10 -SkipHttpErrorCheck
Write-Host ('SA /api/ai-usage/[slug]: {0}' -f $r.StatusCode)
if ($r.StatusCode -eq 200) { $script:pass++ } else { $script:fail++ }

Write-Host ''
Write-Host '=== SA: Statistics by slug ==='
$r = Invoke-WebRequest -Method Get -Uri ('{0}/api/statistics/token-usage/desa-sanreseng-ade' -f $DashboardBase) -Headers $saHeaders -TimeoutSec 10 -SkipHttpErrorCheck
Write-Host ('SA /api/statistics/token-usage/[slug]: {0}' -f $r.StatusCode)
if ($r.StatusCode -eq 200) { $script:pass++ } else { $script:fail++ }

Write-Host ''
Write-Host '=== VA: Settings notifications POST (update notification prefs) ==='
Test-Endpoint -Label 'VA POST /api/settings/notifications' -Method 'Post' -Url "$DashboardBase/api/settings/notifications" -Headers $vaHeaders -Body @{ enabled = $true; urgentNotifications = $true }

Write-Host ''
Write-Host '=== VA: Knowledge consistency scan ==='
Test-Endpoint -Label 'VA POST /api/knowledge-consistency/scan' -Method 'Post' -Url "$DashboardBase/api/knowledge-consistency/scan" -Headers $vaHeaders -Body @{}

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
