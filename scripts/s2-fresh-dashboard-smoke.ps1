param(
  [string]$DashboardBase = 'http://127.0.0.1:3010',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SessionToken {
  param([string]$Username, [string]$Password)
  $body = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
  $headers = @{ 'x-internal-api-key' = $InternalApiKey }
  $r = Invoke-WebRequest -Method Post -Uri "$DashboardBase/api/auth/login" -ContentType 'application/json' -Body $body -Headers $headers -TimeoutSec 15 -SkipHttpErrorCheck
  $result = [pscustomobject]@{
    StatusCode = $r.StatusCode
    Body = $r.Content
    Token = ''
  }
  if ($r.StatusCode -eq 200) {
    $cookieHeader = $r.Headers['Set-Cookie']
    if ($cookieHeader -is [array]) { $cookieHeader = $cookieHeader[0] }
    $token = (([string]$cookieHeader) -split ';')[0] -replace 'token=',''
    $result.Token = $token
  }
  return $result
}

function Test-ApiEndpoint {
  param(
    [string]$Label,
    [string]$Url,
    [string]$Token = '',
    [int]$ExpectedStatus = 200
  )
  $headers = @{}
  if ($Token) { $headers['Cookie'] = ('token={0}' -f $Token) }
  try {
    $r = Invoke-WebRequest -Method Get -Uri $Url -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
    $pass = if ($r.StatusCode -eq $ExpectedStatus) { 'PASS' } else { 'FAIL' }
    Write-Host ('[{0}] {1}: {2} (expected {3})' -f $pass, $Label, $r.StatusCode, $ExpectedStatus)
  } catch {
    Write-Host ('[ERROR] {0}: {1}' -f $Label, $_.Exception.Message)
  }
}

Write-Host '=== LOGIN TESTS ==='
$sa = Get-SessionToken -Username 'superadmin' -Password '1234abcd'
Write-Host ('SA login: {0}' -f $sa.StatusCode)
Write-Host ('  token present: {0}' -f ([bool]$sa.Token))

$va = Get-SessionToken -Username 'admin_sangreseng' -Password 'SangresengAde2026!'
Write-Host ('VA login: {0}' -f $va.StatusCode)
Write-Host ('  token present: {0}' -f ([bool]$va.Token))

# If login fails (rate limit), fall back to DB tokens
if (-not $sa.Token -or -not $va.Token) {
  Write-Host 'Login failed (rate limit?), using tokens from DB...'
  $saToken = docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;"
  $vaToken = docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;"
  if (-not $sa.Token) { $sa.Token = $saToken.Trim() }
  if (-not $va.Token) { $va.Token = $vaToken.Trim() }
}

Write-Host ''
Write-Host '=== RBAC TESTS ==='
Test-ApiEndpoint -Label 'SA -> superadmin/villages' -Url "$DashboardBase/api/superadmin/villages" -Token $sa.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'VA -> laporan' -Url "$DashboardBase/api/laporan" -Token $va.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'VA -> superadmin/villages (block)' -Url "$DashboardBase/api/superadmin/villages" -Token $va.Token -ExpectedStatus 403
Test-ApiEndpoint -Label 'unauth -> laporan (block)' -Url "$DashboardBase/api/laporan" -Token '' -ExpectedStatus 401

Write-Host ''
Write-Host '=== CRITICAL PAGE HTML SMOKE ==='
Test-ApiEndpoint -Label 'login page' -Url "$DashboardBase/login" -Token '' -ExpectedStatus 200
Test-ApiEndpoint -Label 'VA dashboard' -Url "$DashboardBase/dashboard" -Token $va.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'VA laporan' -Url "$DashboardBase/dashboard/laporan" -Token $va.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'VA layanan' -Url "$DashboardBase/dashboard/layanan" -Token $va.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'VA livechat' -Url "$DashboardBase/dashboard/livechat" -Token $va.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'SA villages' -Url "$DashboardBase/dashboard/superadmin/villages" -Token $sa.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'SA admins' -Url "$DashboardBase/dashboard/superadmin/admins" -Token $sa.Token -ExpectedStatus 200
Test-ApiEndpoint -Label 'SA system-health' -Url "$DashboardBase/dashboard/superadmin/system-health" -Token $sa.Token -ExpectedStatus 200

Write-Host ''
Write-Host '=== VA UI LOGIC API SMOKE ==='
$vaEndpoints = @(
  'api/laporan',
  'api/service-requests',
  'api/layanan',
  'api/dashboard/realtime-summary',
  'api/knowledge',
  'api/documents',
  'api/village-profile',
  'api/complaints/categories',
  'api/complaints/types',
  'api/layanan/categories',
  'api/important-contacts',
  'api/channel-settings'
)
foreach ($ep in $vaEndpoints) {
  Test-ApiEndpoint -Label ('VA ' + $ep) -Url "$DashboardBase/$ep" -Token $va.Token -ExpectedStatus 200
}

Write-Host ''
Write-Host '=== SA UI LOGIC API SMOKE ==='
$saEndpoints = @(
  'api/superadmin/villages',
  'api/superadmin/admins',
  'api/superadmin/system-health',
  'api/superadmin/ai-models',
  'api/superadmin/providers',
  'api/superadmin/whatsapp/summary'
)
foreach ($ep in $saEndpoints) {
  Test-ApiEndpoint -Label ('SA ' + $ep) -Url "$DashboardBase/$ep" -Token $sa.Token -ExpectedStatus 200
}
