Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$villageId = 'cmkuvo1dk0000mj60h4u4bq1w'
$waUser = '6289900199002'
$channelBase = 'http://127.0.0.1:3001'
$internalKey = 'govconnect-internal-api-key-2025'

function Send-WaMessage {
  param([string]$Text)
  $ts = [DateTimeOffset]::UtcNow
  $payload = @{
    type = 'Message'
    instanceName = $villageId
    event = @{
      Info = @{
        Sender = ('{0}:24@s.whatsapp.net' -f $waUser)
        Chat = ('{0}@s.whatsapp.net' -f $waUser)
        Type = 'text'
        ID = ('S2SLUG-{0}' -f $ts.ToUnixTimeMilliseconds())
        PushName = 'S2 Slug Test'
        Timestamp = $ts.ToString('o')
        IsFromMe = $false
        IsGroup = $false
      }
      Message = @{ conversation = $Text }
    }
  } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Method Post -Uri "$channelBase/webhook/whatsapp" -ContentType 'application/json' -Body $payload | Out-Null
}

function Get-Messages {
  $headers = @{ 'x-internal-api-key' = $internalKey }
  $uri = "$channelBase/internal/messages?village_id=$villageId&wa_user_id=$waUser&limit=10"
  return (Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 10).messages
}

Write-Host 'Sending: Saya mau buat surat keterangan domisili'
Send-WaMessage -Text 'Saya mau buat surat keterangan domisili'

Write-Host 'Waiting 40s for AI response...'
Start-Sleep -Seconds 40

$msgs = Get-Messages
Write-Host ('Messages: {0}' -f $msgs.Count)
foreach ($m in $msgs) {
  Write-Host ('{0} | {1} | {2}' -f $m.direction, $m.source, $m.message_text.Substring(0,[Math]::Min(200,$m.message_text.Length)))
}

# Check if slug is correct in any OUT message
$outMsgs = $msgs | Where-Object { $_.direction -eq 'OUT' }
$slugOk = $false
foreach ($m in $outMsgs) {
  if ($m.message_text -like '*desa-sanreseng-ade*') {
    Write-Host '[PASS] Slug fix verified: URL contains desa-sanreseng-ade'
    $slugOk = $true
  } elseif ($m.message_text -like '*/form/*') {
    Write-Host ('[FAIL] Form URL found but wrong slug: {0}' -f ($m.message_text | Select-String '/form/[^?]+' | ForEach-Object { $_.Matches[0].Value }))
  }
}
if (-not $slugOk -and $outMsgs.Count -gt 0) {
  Write-Host 'No form URL in response yet (AI may not have offered form link in this turn)'
}
