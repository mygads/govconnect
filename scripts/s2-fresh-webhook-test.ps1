param(
  [string]$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w',
  [string]$WaUser = '6289900152001'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ts = [DateTimeOffset]::UtcNow
$payload = @{
  type = 'Message'
  instanceName = $VillageId
  event = @{
    Info = @{
      Sender = ('{0}:24@s.whatsapp.net' -f $WaUser)
      Chat = ('{0}@s.whatsapp.net' -f $WaUser)
      Type = 'text'
      ID = ('S2FRESH-{0}' -f $ts.ToUnixTimeMilliseconds())
      PushName = 'S2 Fresh Test'
      Timestamp = $ts.ToString('o')
      IsFromMe = $false
      IsGroup = $false
    }
    Message = @{
      conversation = 's2_ halo desa testing fresh webhook'
    }
  }
} | ConvertTo-Json -Depth 10

$r = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3001/webhook/whatsapp' -ContentType 'application/json' -Body $payload -TimeoutSec 10 -SkipHttpErrorCheck
Write-Host ('Webhook POST: {0} | {1}' -f $r.StatusCode, $r.Content)

Start-Sleep -Seconds 3
$headers = @{ 'x-internal-api-key' = 'govconnect-internal-api-key-2025' }
$uri = ('http://127.0.0.1:3001/internal/messages?village_id={0}&wa_user_id={1}&limit=5' -f $VillageId, $WaUser)
$msgs = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 10
Write-Host ('Messages for user {0}: total={1}' -f $WaUser, $msgs.total)
foreach ($m in $msgs.messages) {
  $preview = $m.message_text.Substring(0, [Math]::Min(60, $m.message_text.Length))
  Write-Host ('  {0} | {1} | {2}' -f $m.direction, $m.source, $preview)
}
