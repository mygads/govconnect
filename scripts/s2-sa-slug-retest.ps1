Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DashboardBase = 'http://127.0.0.1:3010'
$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saHeaders = @{ 'Cookie' = ('token=' + $saToken) }

$script:pass = 0
$script:fail = 0

function Test-Get {
  param([string]$Label, [string]$Url, [hashtable]$Headers, [int]$Expected = 200)
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -Headers $Headers -TimeoutSec 10 -SkipHttpErrorCheck
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

Write-Host '=== SA: token-usage slug ==='
$slugs = @('summary', 'by-period', 'by-model', 'by-provider')
foreach ($slug in $slugs) {
  Test-Get -Label ('SA /api/statistics/token-usage/' + $slug) -Url "$DashboardBase/api/statistics/token-usage/$slug" -Headers $saHeaders
}

Write-Host ''
Write-Host '=== SA: statistics/ai-usage/[model] with valid model ==='
# Need a real model slug from DB
$models = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT upstream_model_name FROM ai.ai_models WHERE is_active=true LIMIT 3;").Trim() -split "`n"
foreach ($m in $models) {
  $mTrimmed = $m.Trim()
  if ($mTrimmed) {
    # URL-encode the model name
    $encoded = [System.Web.HttpUtility]::UrlEncode($mTrimmed)
    Test-Get -Label ('SA /api/statistics/ai-usage/' + $mTrimmed.Substring(0, [Math]::Min(25, $mTrimmed.Length))) -Url "$DashboardBase/api/statistics/ai-usage/$encoded" -Headers $saHeaders
  }
}

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
