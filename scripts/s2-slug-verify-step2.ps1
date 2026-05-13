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
  param([int]$Take = 15)
  $headers = @{ 'x-internal-api-key' = $internalKey }
  $uri = "$channelBase/internal/messages?village_id=$villageId&wa_user_id=$waUser&limit=$Take"
  return (Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 10).messages
}

function Wait-ForOutMessage {
  param([string[]]$BeforeIds, [int]$TimeoutSec = 40)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $msgs = Get-Messages
    $newOut = @($msgs | Where-Object { $_.direction -eq 'OUT' -and $BeforeIds -notcontains $_.id })
    if ($newOut.Count -gt 0) { return $newOut }
    Start-Sleep -Seconds 3
  }
  return @()
}

# Get current message IDs
$before = Get-Messages
$beforeIds = @($before | ForEach-Object { $_.id })

Write-Host '=== Step 1: Send iya to trigger form link ==='
Send-WaMessage -Text 'iya'
$newMsgs = Wait-ForOutMessage -BeforeIds $beforeIds -TimeoutSec 45
foreach ($m in $newMsgs) {
  Write-Host ('{0} | {1}' -f $m.direction, $m.message_text.Substring(0,[Math]::Min(300,$m.message_text.Length)))
}

# Check slug
$formMsg = $newMsgs | Where-Object { $_.message_text -like '*/form/*' }
if ($formMsg) {
  $url = [regex]::Match($formMsg.message_text, '/form/[^\s?]+').Value
  Write-Host ('Form URL path: {0}' -f $url)
  if ($formMsg.message_text -like '*desa-sanreseng-ade*') {
    Write-Host '[PASS] Slug fix VERIFIED: URL contains desa-sanreseng-ade'
  } elseif ($formMsg.message_text -like '*sanreseng-ade*') {
    Write-Host '[FAIL] Still using short_name: sanreseng-ade'
  }
} else {
  Write-Host 'No form URL in response'
  Write-Host 'Full responses:'
  foreach ($m in $newMsgs) { Write-Host $m.message_text }
}
