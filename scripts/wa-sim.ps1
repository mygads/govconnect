param(
  [Parameter(Mandatory = $true)]
  [string]$VillageId,

  [Parameter(Mandatory = $true)]
  [string]$WaUserId,

  [Parameter(Mandatory = $true)]
  [string]$Message,

  [string]$ChannelBaseUrl = 'http://localhost:3001',
  [string]$InternalApiKey = 'govconnect-internal-api-key-2025',
  [int]$PollSeconds = 12,
  [int]$Limit = 8
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-GenfityWebhookPayload {
  param(
    [Parameter(Mandatory = $true)] [string]$InstanceName,
    [Parameter(Mandatory = $true)] [string]$WaUserId,
    [Parameter(Mandatory = $true)] [string]$Text
  )

  $ts = [DateTimeOffset]::UtcNow
  $msgId = "SIM-$($ts.ToUnixTimeMilliseconds())-MSG"

  return @{
    type = 'Message'
    instanceName = $InstanceName
    event = @{
      Info = @{
        Sender    = "$WaUserId:24@s.whatsapp.net"
        Chat      = "$WaUserId@s.whatsapp.net"
        Type      = 'text'
        ID        = $msgId
        PushName  = 'Sim User'
        Timestamp = $ts.ToString('o')
        IsFromMe  = $false
        IsGroup   = $false
      }
      Message = @{
        conversation = $Text
      }
    }
  }
}

function Send-WebhookMessage {
  param(
    [Parameter(Mandatory = $true)] [string]$ChannelBaseUrl,
    [Parameter(Mandatory = $true)] [hashtable]$Payload
  )

  $uri = "$ChannelBaseUrl/webhook/whatsapp"
  Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body ($Payload | ConvertTo-Json -Depth 10) | Out-Null
}

function Get-InternalMessages {
  param(
    [Parameter(Mandatory = $true)] [string]$ChannelBaseUrl,
    [Parameter(Mandatory = $true)] [string]$InternalApiKey,
    [Parameter(Mandatory = $true)] [string]$VillageId,
    [Parameter(Mandatory = $true)] [string]$WaUserId,
    [int]$Limit = 8
  )

  $headers = @{ 'x-internal-api-key' = $InternalApiKey }
  $uri = "$ChannelBaseUrl/internal/messages?village_id=$VillageId&wa_user_id=$WaUserId&limit=$Limit"
  return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
}

Write-Host "Sending WA message..." -ForegroundColor Cyan
$payload = New-GenfityWebhookPayload -InstanceName $VillageId -WaUserId $WaUserId -Text $Message
Send-WebhookMessage -ChannelBaseUrl $ChannelBaseUrl -Payload $payload

Write-Host "Polling messages for up to $PollSeconds seconds..." -ForegroundColor Cyan
Start-Sleep -Seconds $PollSeconds

$result = Get-InternalMessages -ChannelBaseUrl $ChannelBaseUrl -InternalApiKey $InternalApiKey -VillageId $VillageId -WaUserId $WaUserId -Limit $Limit

# Print newest first (API already returns newest-first)
$result.messages | Select-Object id,direction,source,timestamp,message_text | Format-List | Out-String

<##
USAGE EXAMPLES

# 1) Address/profile Q&A
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'Alamat kantor desa?'

# 2) Requirements + offer
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'Syarat pembuatan surat pindah apa saja?'

# 2b) Disambiguation example (if multiple services match)
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'Syarat surat keterangan apa saja?'

# 2c) Pick one of the options (after disambiguation prompt)
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message '1'

# 3) Confirm offer (send link)
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'iya'

# 4) Status check
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'cek status LAY-20260128-001'

# 5) Detail mode
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'detail LAY-20260128-001'

# 6) Detail latest (no ticket)
./scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234567890 -Message 'detail terakhir'

##>