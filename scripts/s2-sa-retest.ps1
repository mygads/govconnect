Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$saHeaders = @{ 'Cookie' = ('token=' + $saToken) }

$endpoints = @('api/cache', 'api/settings', 'api/statistics/ai-usage')
foreach ($ep in $endpoints) {
  $r = Invoke-WebRequest -Method Get -Uri ('http://127.0.0.1:3010/' + $ep) -Headers $saHeaders -TimeoutSec 10 -SkipHttpErrorCheck
  $preview = $r.Content.Substring(0, [Math]::Min(80, $r.Content.Length))
  Write-Host ('SA /{0}: {1} | {2}' -f $ep, $r.StatusCode, $preview)
}
