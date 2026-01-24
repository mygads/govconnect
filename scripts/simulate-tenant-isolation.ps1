param(
  [string]$ChannelServiceUrl = "http://localhost:3001",
  [string]$InternalApiKey = "",
  [string]$WaUserId = "628123456789",
  [string]$VillageA = "village-A",
  [string]$VillageB = "village-B"
)

if ([string]::IsNullOrWhiteSpace($InternalApiKey)) {
  Write-Host "ERROR: -InternalApiKey is required (x-internal-api-key)" -ForegroundColor Red
  exit 1
}

function New-WebhookJsonData([string]$chatJid, [string]$messageId, [string]$text) {
  $payload = @{
    type  = "Message"
    event = @{
      Info    = @{
        Chat      = $chatJid
        IsGroup   = $false
        IsFromMe  = $false
        ID        = $messageId
        PushName  = "Test User"
        Timestamp = (Get-Date).ToString("o")
      }
      Message = @{
        conversation = $text
      }
    }
  }
  return ($payload | ConvertTo-Json -Depth 10 -Compress)
}

$webhookUrl = "$ChannelServiceUrl/webhook/whatsapp"
$internalMessagesUrl = "$ChannelServiceUrl/internal/messages"
$internalSendUrl = "$ChannelServiceUrl/internal/send"

$chatJid = "$WaUserId@s.whatsapp.net"

Write-Host "Posting webhook for VillageA=$VillageA, WaUserId=$WaUserId" -ForegroundColor Cyan
$jsonA = New-WebhookJsonData -chatJid $chatJid -messageId ("msgA_" + [guid]::NewGuid().ToString("N")) -text "Halo dari $VillageA"
Invoke-RestMethod -Method Post -Uri $webhookUrl -ContentType "application/x-www-form-urlencoded" -Body @{
  instanceName = $VillageA
  userID       = $VillageA
  jsonData     = $jsonA
} | Out-Null

Write-Host "Posting webhook for VillageB=$VillageB, WaUserId=$WaUserId" -ForegroundColor Cyan
$jsonB = New-WebhookJsonData -chatJid $chatJid -messageId ("msgB_" + [guid]::NewGuid().ToString("N")) -text "Halo dari $VillageB"
Invoke-RestMethod -Method Post -Uri $webhookUrl -ContentType "application/x-www-form-urlencoded" -Body @{
  instanceName = $VillageB
  userID       = $VillageB
  jsonData     = $jsonB
} | Out-Null

Start-Sleep -Seconds 1

$headers = @{ "x-internal-api-key" = $InternalApiKey }

Write-Host "\nFetching messages for VillageA (should contain only VillageA text)" -ForegroundColor Yellow
$respA = Invoke-RestMethod -Method Get -Uri ("$internalMessagesUrl?wa_user_id=$WaUserId&limit=20&village_id=$VillageA") -Headers $headers
$messagesA = @($respA.messages)
Write-Host ("VillageA total=" + $messagesA.Count)
$messagesA | Select-Object -First 5 | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "\nFetching messages for VillageB (should contain only VillageB text)" -ForegroundColor Yellow
$respB = Invoke-RestMethod -Method Get -Uri ("$internalMessagesUrl?wa_user_id=$WaUserId&limit=20&village_id=$VillageB") -Headers $headers
$messagesB = @($respB.messages)
Write-Host ("VillageB total=" + $messagesB.Count)
$messagesB | Select-Object -First 5 | Format-Table -AutoSize | Out-String | Write-Host

Write-Host "\nTriggering tenant-scoped send (requires channel-service env WA_DRY_RUN=true)" -ForegroundColor Green
$sendBodyA = @{ village_id = $VillageA; wa_user_id = $WaUserId; message = "Test reply from $VillageA" } | ConvertTo-Json
$sendBodyB = @{ village_id = $VillageB; wa_user_id = $WaUserId; message = "Test reply from $VillageB" } | ConvertTo-Json

try {
  $sendA = Invoke-RestMethod -Method Post -Uri $internalSendUrl -Headers ($headers + @{"Content-Type"="application/json"}) -Body $sendBodyA
  $sendB = Invoke-RestMethod -Method Post -Uri $internalSendUrl -Headers ($headers + @{"Content-Type"="application/json"}) -Body $sendBodyB
  Write-Host "Send A response:"; $sendA | ConvertTo-Json -Depth 10 | Write-Host
  Write-Host "Send B response:"; $sendB | ConvertTo-Json -Depth 10 | Write-Host
} catch {
  Write-Host "Send failed (expected if WA_DRY_RUN is not enabled or WA token not configured)." -ForegroundColor DarkYellow
  Write-Host $_
}

Write-Host "\nDone. Validate logs: channel-service should log WA_DRY_RUN with token_source per village." -ForegroundColor Cyan
