Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$villageId = 'cmkuvo1dk0000mj60h4u4bq1w'
$waUser = '6289900199003'  # fresh user
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
        ID = ('S2SLUG2-{0}' -f $ts.ToUnixTimeMilliseconds())
        PushName = 'S2 Slug Test 2'
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
  $uri = "$channelBase/internal/messages?village_id=$villageId&wa_user_id=$waUser&limit=20"
  return (Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 10).messages
}

function Wait-ForOutMessage {
  param([string[]]$BeforeIds, [int]$TimeoutSec = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $msgs = Get-Messages
    $newOut = @($msgs | Where-Object { $_.direction -eq 'OUT' -and $BeforeIds -notcontains $_.id })
    if ($newOut.Count -gt 0) { return $newOut }
    Start-Sleep -Seconds 3
  }
  return @()
}

Write-Host '=== Step 1: Service info request (fresh user) ==='
$before = @()
Send-WaMessage -Text 'Saya mau buat surat keterangan domisili'
$step1 = Wait-ForOutMessage -BeforeIds $before -TimeoutSec 45
foreach ($m in $step1) { Write-Host ('OUT: {0}' -f $m.message_text.Substring(0,[Math]::Min(250,$m.message_text.Length))) }

Write-Host ''
Write-Host '=== Step 2: Confirm (iya) to get form link ==='
$beforeIds2 = @($step1 | ForEach-Object { $_.id })
Send-WaMessage -Text 'iya'
$step2 = Wait-ForOutMessage -BeforeIds $beforeIds2 -TimeoutSec 45
foreach ($m in $step2) { Write-Host ('OUT: {0}' -f $m.message_text.Substring(0,[Math]::Min(300,$m.message_text.Length))) }

# Check slug in form URL
$allOut = @($step1 + $step2)
$formMsg = $allOut | Where-Object { $_.message_text -like '*/form/*' }
if ($formMsg) {
  $url = [regex]::Match($formMsg.message_text, 'http[^\s]+').Value
  Write-Host ('Form URL: {0}' -f $url)
  if ($url -like '*desa-sanreseng-ade*') {
    Write-Host '[PASS] Slug fix VERIFIED: URL contains desa-sanreseng-ade'
  } elseif ($url -like '*sanreseng-ade*') {
    Write-Host '[FAIL] Still using short_name: sanreseng-ade'
  } else {
    Write-Host ('[INFO] URL found but no slug match: {0}' -f $url)
  }
} else {
  Write-Host '[INFO] No /form/ URL in responses yet'
  Write-Host 'All OUT messages:'
  foreach ($m in $allOut) { Write-Host $m.message_text }
}
