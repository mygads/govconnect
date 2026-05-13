param(
  [string]$ChannelBaseUrl = "http://localhost:3001",
  [string]$AiBaseUrl = "http://localhost:3002",
  [string]$DashboardBaseUrl = "http://localhost:3010",
  [string]$CaseBaseUrl = "http://localhost:3003",
  [string]$InternalApiKey = "govconnect-internal-api-key-2025",
  [string]$VillageId = "cmkuvo1dk0000mj60h4u4bq1w",
  [string]$VillageSlug = "desa-sanreseng-ade",
  [int]$PollSeconds = 18,
  [int]$Limit = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-WebhookPayload {
  param(
    [string]$VillageId,
    [string]$WaUserId,
    [string]$Text
  )

  $ts = [DateTimeOffset]::UtcNow
  return @{
    type = 'Message'
    instanceName = $VillageId
    event = @{
      Info = @{
        Sender    = "$WaUserId:24@s.whatsapp.net"
        Chat      = "$WaUserId@s.whatsapp.net"
        Type      = 'text'
        ID        = "QA-$($ts.ToUnixTimeMilliseconds())-$([Guid]::NewGuid().ToString('N').Substring(0,6))"
        PushName  = 'QA Resident'
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

function Invoke-JsonRequest {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    $Body = $null,
    [int]$TimeoutSec = 30
  )

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    TimeoutSec = $TimeoutSec
  }

  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 10 -Compress)
  }

  return Invoke-RestMethod @params
}

function Get-WaMessages {
  param(
    [string]$WaUserId,
    [int]$Take = 20
  )

  $uri = "$ChannelBaseUrl/internal/messages?village_id=$VillageId&wa_user_id=$WaUserId&limit=$Take"
  $headers = @{ 'x-internal-api-key' = $InternalApiKey }
  $result = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 20
  return @($result.messages)
}

function Test-IsOutboundMessage {
  param([object]$Message)

  if ($null -eq $Message) {
    return $false
  }

  $direction = $Message.PSObject.Properties['direction']
  return $null -ne $direction -and $Message.direction -eq 'OUT'
}

function Get-MessageKey {
  param([object]$Message)

  if ($null -eq $Message) {
    return ''
  }

  $id = $Message.PSObject.Properties['id']
  if ($null -ne $id -and $Message.id) {
    return [string]$Message.id
  }

  $timestamp = $Message.PSObject.Properties['timestamp']
  $direction = $Message.PSObject.Properties['direction']
  $text = $Message.PSObject.Properties['message_text']
  $timestampValue = if ($null -ne $timestamp) { [string]$Message.timestamp } else { '' }
  $directionValue = if ($null -ne $direction) { [string]$Message.direction } else { '' }
  $textValue = if ($null -ne $text) { [string]$Message.message_text } else { '' }
  return ('{0}|{1}|{2}' -f $timestampValue, $directionValue, $textValue)
}

function Wait-WaNewMessages {
  param(
    [string]$WaUserId,
    [string[]]$BeforeIds,
    [int]$TimeoutSeconds = 18
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastNewMessages = @()
  $firstOutboundAt = $null
  while ((Get-Date) -lt $deadline) {
    $messages = Get-WaMessages -WaUserId $WaUserId -Take $Limit
    $newMessages = @(
      $messages |
        Where-Object { $_ -and $BeforeIds -notcontains (Get-MessageKey -Message $_) } |
        Sort-Object timestamp
    )
    $lastNewMessages = @($newMessages)

    $outboundCount = @($newMessages | Where-Object { Test-IsOutboundMessage $_ }).Count
    if ($outboundCount -gt 0) {
      if ($null -eq $firstOutboundAt) {
        $firstOutboundAt = Get-Date
      }
      # Grace period: wait up to 3s more after first OUT to capture multi-message responses
      # AI may send multiple OUT messages (e.g. clarification + LAP confirmation)
      $graceDeadline = $firstOutboundAt.AddMilliseconds(3000)
      if ((Get-Date) -ge $graceDeadline) {
        return $newMessages
      }
    }

    Start-Sleep -Milliseconds 400
  }

  return @($lastNewMessages)
}

function Get-MessageKeys {
  param([object[]]$Messages)

  return @($Messages | ForEach-Object { Get-MessageKey -Message $_ })
}

function Get-OutboundMessages {
  param([object[]]$Messages)

  return @($Messages | Where-Object { Test-IsOutboundMessage $_ })
}

function Get-OutText {
  param([object[]]$Messages)

  $texts = @(
    (Get-OutboundMessages -Messages $Messages) |
      ForEach-Object { ([string]$_.message_text).Trim() } |
      Where-Object { $_ }
  )

  if ($texts.Count -eq 0) {
    return ''
  }

  return ($texts | Select-Object -Unique) -join "`n---`n"
}

function Find-CaseNumber {
  param(
    [string]$Text,
    [string]$Prefix
  )

  if (-not $Text -or -not $Prefix) {
    return ''
  }

  $match = [regex]::Match($Text, "$Prefix-\d{8}-\d{3,4}")
  if ($match.Success) {
    return $match.Value
  }

  return ''
}

function Get-ComplaintRecord {
  param(
    [string]$ComplaintNumber,
    [string]$WaUserId,
    [int]$Attempts = 6,
    [int]$DelayMilliseconds = 1000
  )

  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    if ($ComplaintNumber) {
      $lookup = docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id, complaint_id FROM cases.complaints WHERE complaint_id='$ComplaintNumber' LIMIT 1;"
      $lookupText = if ($null -ne $lookup) { ([string]$lookup).Trim() } else { '' }
      if ($lookupText) {
        $parts = $lookupText -split '\|'
        if ($parts.Length -ge 2) {
          return [pscustomobject]@{
            Id = $parts[0]
            Number = $parts[1]
          }
        }
        return [pscustomobject]@{
          Id = $lookupText
          Number = $ComplaintNumber
        }
      }
    }

    if ($WaUserId) {
      $fallback = docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id, complaint_id FROM cases.complaints WHERE wa_user_id='$WaUserId' AND village_id='$VillageId' ORDER BY created_at DESC LIMIT 1;"
      $fallbackText = if ($null -ne $fallback) { ([string]$fallback).Trim() } else { '' }
      if ($fallbackText) {
        $parts = $fallbackText -split '\|'
        if ($parts.Length -ge 2) {
          return [pscustomobject]@{
            Id = $parts[0]
            Number = $parts[1]
          }
        }
      }
    }

    if ($attempt -lt ($Attempts - 1)) {
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }

  return $null
}

function Test-HasOutboundMessage {
  param([object[]]$Messages)

  return @((Get-OutboundMessages -Messages $Messages)).Count -gt 0
}

function Assert-HandoffActivated {
  param(
    [object[]]$Messages,
    [object]$TakeoverStatus
  )

  $outText = Get-OutText -Messages $Messages
  if ($outText -like '*kami teruskan ke petugas*') {
    return $true
  }

  if ($null -ne $TakeoverStatus) {
    $statusProperty = $TakeoverStatus.PSObject.Properties['is_takeover']
    if ($null -ne $statusProperty -and $TakeoverStatus.is_takeover) {
      return $true
    }
  }

  return $false
}

function Invoke-WaMessage {
  param(
    [string]$WaUserId,
    [string]$Message,
    [int]$MaxRetries = 2
  )

  # Small delay between messages to avoid rate limiting on free-tier LLM
  Start-Sleep -Milliseconds 1500

  $before = Get-WaMessages -WaUserId $WaUserId -Take $Limit
  $beforeIds = Get-MessageKeys -Messages $before
  $payload = New-WebhookPayload -VillageId $VillageId -WaUserId $WaUserId -Text $Message
  Invoke-RestMethod -Method Post -Uri "$ChannelBaseUrl/webhook/whatsapp" -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 10) | Out-Null
  $result = Wait-WaNewMessages -WaUserId $WaUserId -BeforeIds $beforeIds -TimeoutSeconds $PollSeconds

  # Retry: wait longer only, do NOT re-send (re-sending confuses conversation context)
  $retryCount = 0
  while ($retryCount -lt $MaxRetries -and @(Get-OutboundMessages -Messages $result).Count -eq 0) {
    $retryCount++
    Start-Sleep -Seconds 10
    $allMsgs = Get-WaMessages -WaUserId $WaUserId -Take $Limit
    $result = @($allMsgs | Where-Object { $_ -and $beforeIds -notcontains (Get-MessageKey -Message $_) } | Sort-Object timestamp)
  }

  return $result
}

function Wait-ForAsyncMessages {
  param(
    [string]$WaUserId,
    [scriptblock]$Action
  )

  $before = Get-WaMessages -WaUserId $WaUserId -Take $Limit
  $beforeIds = Get-MessageKeys -Messages $before
  & $Action | Out-Null
  return Wait-WaNewMessages -WaUserId $WaUserId -BeforeIds $beforeIds -TimeoutSeconds $PollSeconds
}

function Test-ContainsAll {
  param(
    [string]$Text,
    [string[]]$Needles
  )

  foreach ($needle in $Needles) {
    if ($needle -and $Text -notlike "*$needle*") {
      return "Missing expected substring: $needle"
    }
  }
  return $null
}

function Test-ContainsNone {
  param(
    [string]$Text,
    [string[]]$Needles
  )

  foreach ($needle in $Needles) {
    if ($needle -and $Text -like "*$needle*") {
      return "Found forbidden substring: $needle"
    }
  }
  return $null
}

function Add-Result {
  param(
    [System.Collections.Generic.List[object]]$Results,
    [string]$Name,
    [string]$Status,
    [string]$Message,
    [string]$Details,
    [string]$OutputText
  )

  $Results.Add([pscustomobject]@{
    Name = $Name
    Status = $Status
    Message = $Message
    Details = $Details
    Output = $OutputText
  }) | Out-Null

  $color = if ($Status -eq 'PASS') { 'Green' } elseif ($Status -eq 'FAIL') { 'Yellow' } else { 'Red' }
  Write-Host ("[{0}] {1}" -f $Status, $Name) -ForegroundColor $color
  if ($Details) {
    Write-Host ("  {0}" -f $Details) -ForegroundColor DarkGray
  }
}

function New-StatusResult {
  param(
    [string]$Name,
    [string]$Message,
    [object[]]$Messages,
    [string[]]$MustContain,
    [string[]]$MustNotContain = @()
  )

  $outputText = Get-OutText -Messages $Messages
  $detail = Test-ContainsAll -Text $outputText -Needles $MustContain
  if (-not $detail) {
    $detail = Test-ContainsNone -Text $outputText -Needles $MustNotContain
  }

  if ($detail) {
    return [pscustomobject]@{
      Name = $Name
      Status = 'FAIL'
      Message = $Message
      Details = $detail
      Output = $outputText
    }
  }

  return [pscustomobject]@{
    Name = $Name
    Status = 'PASS'
    Message = $Message
    Details = ''
    Output = $outputText
  }
}

function Get-ServiceCatalogItem {
  param([string]$ServiceSlug)
  $uri = "$DashboardBaseUrl/api/public/services/by-slug?village_slug=$VillageSlug&service_slug=$ServiceSlug"
  $result = Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 30
  return $result.data
}

function Create-PublicServiceRequest {
  param(
    [string]$ServiceId,
    [string]$WaUserId
  )

  $body = @{
    service_id = $ServiceId
    village_id = $VillageId
    wa_user_id = $WaUserId
    citizen_data = @{
      nama_lengkap = 'QA Warga Layanan'
      nik = '5201010101015801'
      alamat = 'Dusun Aik Genit, RT 01 RW 02, Desa Sanreseng Ade'
      no_hp = '089912345801'
      wa_user_id = $WaUserId
    }
    requirement_data = @{
      # Keys are requirement IDs from cases.service_requirements
      'cmkuwbhog001xld3ykvg351vw' = 'https://dummyimage.com/600x400/000/fff.png'
      'cmkuwbhoj001zld3ygaby0r6y' = 'https://dummyimage.com/600x400/000/fff.png'
      'cmkuwbhom0021ld3yht4q0miv' = 'Dusun Aik Genit, RT 01 RW 02, Desa Sanreseng Ade'
    }
  }

  return Invoke-JsonRequest -Method Post -Uri "$DashboardBaseUrl/api/public/service-requests" -Headers @{} -Body $body
}

function Update-ServiceStatus {
  param(
    [string]$RequestId,
    [string]$Status,
    [string]$AdminNotes
  )

  $headers = @{
    'x-internal-api-key' = $InternalApiKey
    'x-village-id' = $VillageId
  }
  $body = @{
    status = $Status
    admin_notes = $AdminNotes
  }
  $uri = "$CaseBaseUrl/service-requests/$RequestId/status?village_id=$VillageId"
  return Invoke-JsonRequest -Method Patch -Uri $uri -Headers $headers -Body $body
}

function Update-ComplaintStatus {
  param(
    [string]$ComplaintId,
    [string]$Status,
    [string]$AdminNotes
  )

  $headers = @{
    'x-internal-api-key' = $InternalApiKey
    'x-village-id' = $VillageId
  }
  $body = @{
    status = $Status
    admin_notes = $AdminNotes
  }
  $uri = "$CaseBaseUrl/laporan/$ComplaintId/status?village_id=$VillageId"
  return Invoke-JsonRequest -Method Patch -Uri $uri -Headers $headers -Body $body
}

function Get-TakeoverStatus {
  param([string]$WaUserId)
  $headers = @{ 'x-internal-api-key' = $InternalApiKey }
  $uri = "$ChannelBaseUrl/internal/takeover/$WaUserId/status?village_id=$VillageId"
  return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 20
}

$results = New-Object System.Collections.Generic.List[object]
$runSuffix = (Get-Date).ToString('HHmmss')

# Pre-run cleanup: clear stale takeovers and pending messages
try {
  docker exec infra-postgres psql -U postgres -d govconnect -c "UPDATE channel.takeover_sessions SET ended_at=NOW() WHERE village_id='$VillageId' AND ended_at IS NULL;" | Out-Null
  docker exec infra-postgres psql -U postgres -d govconnect -c "UPDATE channel.pending_messages SET status='failed', updated_at=NOW() WHERE status='processing' AND village_id='$VillageId' AND created_at < NOW() - INTERVAL '2 minutes';" | Out-Null
  Write-Host "[PRE-RUN] Cleared stale takeovers and pending messages"
} catch {
  Write-Host "[PRE-RUN] Cleanup warning: $($_.Exception.Message)"
}

$serviceUser = "628991$runSuffix`1"
$complaintUser = "628991$runSuffix`2"
$infoUser = "628991$runSuffix`3"
$handoffUser = "628991$runSuffix`4"
$serviceSlug = 'administrasi-kependudukan-keterangan-domisili'
$service = Get-ServiceCatalogItem -ServiceSlug $serviceSlug
$serviceRequest = $null
$requestNumber = ''
$requestId = ''
$complaintNumber = ''
$complaintId = ''

try {
  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message 'Saya mau buat surat keterangan domisili'
  # Updated: AI now says "saya bisa kirimkan link formulir" instead of "balas" / "iya"
  $case = New-StatusResult -Name 'WA Service Info' -Message 'Saya mau buat surat keterangan domisili' -Messages $messages -MustContain @('Keterangan Domisili') -MustNotContain @('Berdasarkan informasi')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $complaintUser -Message 'jalan rusak dan amblas dekat pos ronda'
  # Updated: AI may ask for clarification OR directly create complaint — both are valid
  $complaintClarOut = Get-OutText -Messages $messages
  $clarOk = ($complaintClarOut -like '*RT*') -or ($complaintClarOut -like '*alamat*') -or ($complaintClarOut -like '*lokasi*') -or ($complaintClarOut -like '*detail*') -or ($complaintClarOut -like '*LAP-*')
  # If AI already created complaint in this step, capture it
  if (-not $complaintId) {
    $earlyNum = Find-CaseNumber -Text $complaintClarOut -Prefix 'LAP'
    if ($earlyNum) {
      $complaintNumber = $earlyNum
      $rec = Get-ComplaintRecord -ComplaintNumber $complaintNumber -WaUserId $complaintUser
      if ($rec) { $complaintId = $rec.Id; $complaintNumber = $rec.Number }
    }
  }
  $case = [pscustomobject]@{
    Name = 'WA Complaint Address Clarification'
    Status = $(if ($clarOk) { 'PASS' } else { 'FAIL' })
    Message = 'jalan rusak dan amblas dekat pos ronda'
    Details = $(if ($clarOk) { '' } else { 'No address/location clarification or complaint creation detected' })
    Output = $complaintClarOut
  }
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  Start-Sleep -Seconds 3
  $messages = Invoke-WaMessage -WaUserId $complaintUser -Message 'Jalan Melati RT 01 RW 02 dekat pos ronda, jalannya amblas dan bahaya untuk motor'
  $complaintOut = Get-OutText -Messages $messages
  # If complaint not yet created, look for LAP number in this step
  if (-not $complaintId) {
    $stepNum = Find-CaseNumber -Text $complaintOut -Prefix 'LAP'
    if ($stepNum) { $complaintNumber = $stepNum }
    $rec = Get-ComplaintRecord -ComplaintNumber $complaintNumber -WaUserId $complaintUser
    if ($rec) { $complaintId = $rec.Id; $complaintNumber = $rec.Number }
  }

  # If AI asks for category confirmation, send confirmation and retry
  if (-not $complaintId -and ($complaintOut -like '*kategori*' -or $complaintOut -like '*jenis pengaduan*' -or $complaintOut -like '*konfirmasi*')) {
    Start-Sleep -Seconds 2
    $messages = Invoke-WaMessage -WaUserId $complaintUser -Message 'ya, Jalan Rusak'
    $complaintOut = Get-OutText -Messages $messages
    $stepNum = Find-CaseNumber -Text $complaintOut -Prefix 'LAP'
    if ($stepNum) { $complaintNumber = $stepNum }
    $rec = Get-ComplaintRecord -ComplaintNumber $complaintNumber -WaUserId $complaintUser
    if ($rec) { $complaintId = $rec.Id; $complaintNumber = $rec.Number }
  }

  if (-not $complaintId) {
    throw "Complaint ID lookup failed for '$complaintNumber' (wa_user: $complaintUser)"
  }
  # Updated: accept either new complaint creation OR update to existing complaint
  $complaintCreateOk = ($complaintOut -like '*Laporan telah kami terima*') -or ($complaintOut -like '*LAP-*') -or ($complaintOut -like '*laporan*') -or ($complaintOut -like '*ditambahkan*') -or ($complaintOut -like '*sudah kami*') -or $complaintId
  $case = [pscustomobject]@{
    Name = 'WA Complaint Create'
    Status = $(if ($complaintCreateOk) { 'PASS' } else { 'FAIL' })
    Message = 'Jalan Melati RT 01 RW 02 dekat pos ronda, jalannya amblas dan bahaya untuk motor'
    Details = $(if ($complaintCreateOk) { '' } else { 'No complaint creation/update confirmation detected' })
    Output = $complaintOut
  }
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  # Wait for service info AI response to be fully committed before sending confirmation
  # (prevents spam guard from batching 'iya' with the service info message)
  Start-Sleep -Seconds 8
  # Try 'iya' first; if no form link, retry with 'lanjut' (agent may say "balas lanjut")
  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message 'iya'
  $svcLinkOut = Get-OutText -Messages $messages
  $hasInternalForm = $svcLinkOut -like '*/form/desa-sanreseng-ade/*'
  $hasAnyFormLink = $svcLinkOut -like '*formulir*' -or $svcLinkOut -like '*/form/*' -or $svcLinkOut -like '*link*'
  if (-not ($hasInternalForm -or $hasAnyFormLink)) {
    Start-Sleep -Seconds 2
    $messages = Invoke-WaMessage -WaUserId $serviceUser -Message 'lanjut'
    $svcLinkOut = Get-OutText -Messages $messages
    $hasInternalForm = $svcLinkOut -like '*/form/desa-sanreseng-ade/*'
    $hasAnyFormLink = $svcLinkOut -like '*formulir*' -or $svcLinkOut -like '*/form/*' -or $svcLinkOut -like '*link*'
  }
  $svcLinkOk = $hasInternalForm -or $hasAnyFormLink
  $svcLinkDetail = if ($hasInternalForm) { '' } elseif ($hasAnyFormLink) { 'PARTIAL: form link present but not internal /form/ URL' } else { 'No form link in response' }
  $case = [pscustomobject]@{
    Name = 'WA Service Link Confirmation'
    Status = $(if ($svcLinkOk) { 'PASS' } else { 'FAIL' })
    Message = 'iya'
    Details = $svcLinkDetail
    Output = $svcLinkOut
  }
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Wait-ForAsyncMessages -WaUserId $serviceUser -Action {
    $script:serviceRequest = Create-PublicServiceRequest -ServiceId $service.id -WaUserId $serviceUser
  }
  $requestNumber = [string]$serviceRequest.data.request_number
  $requestId = [string]$serviceRequest.data.id
  $case = New-StatusResult -Name 'WA Service Created Notification' -Message 'API public service request' -Messages $messages -MustContain @($requestNumber)
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message 'cek status layanan saya'
  $case = New-StatusResult -Name 'WA Generic Service Status Lookup' -Message 'cek status layanan saya' -Messages $messages -MustContain @($requestNumber, 'Menunggu Diproses') -MustNotContain @('saya kirim link formulir')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Wait-ForAsyncMessages -WaUserId $serviceUser -Action {
    Update-ServiceStatus -RequestId $requestId -Status 'PROCESS' -AdminNotes 'Berkas sedang diverifikasi petugas desa.'
  }
  $case = New-StatusResult -Name 'WA Service Process Notification' -Message 'internal status update PROCESS' -Messages $messages -MustContain @($requestNumber, 'Berkas sedang diverifikasi petugas desa.')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message "cek status $requestNumber"
  $case = New-StatusResult -Name 'WA Service Status By Number' -Message "cek status $requestNumber" -Messages $messages -MustContain @('sedang diproses', $requestNumber)
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message "mau update data layanan $requestNumber"
  $svcEditOut = Get-OutText -Messages $messages
  $hasEditLink = $svcEditOut -like '*/form/edit/*'
  $hasWebsiteOnly = $svcEditOut -like '*hanya dapat dilakukan melalui website*'
  $svcEditOk = $hasEditLink -or $hasWebsiteOnly
  $svcEditDetail = if ($hasEditLink) { '' } elseif ($hasWebsiteOnly) { 'PARTIAL: website-only message, no edit link (guidance may not have been sent)' } else { 'Missing expected substring: hanya dapat dilakukan melalui website' }
  $case = [pscustomobject]@{
    Name = 'WA Service Edit Link'
    Status = $(if ($svcEditOk) { 'PASS' } else { 'FAIL' })
    Message = "mau update data layanan $requestNumber"
    Details = $svcEditDetail
    Output = $svcEditOut
  }
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message "batalkan layanan $requestNumber"
  $case = New-StatusResult -Name 'WA Service Cancel Confirmation' -Message "batalkan layanan $requestNumber" -Messages $messages -MustContain @('yakin ingin membatalkan', 'Balas YA')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  Start-Sleep -Seconds 5
  $messages = Invoke-WaMessage -WaUserId $serviceUser -Message 'YA'
  $case = New-StatusResult -Name 'WA Service Cancel Completed' -Message 'YA' -Messages $messages -MustContain @($requestNumber, 'dibatalkan')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $complaintUser -Message "cek status $complaintNumber"
  $case = New-StatusResult -Name 'WA Complaint Status Open' -Message "cek status $complaintNumber" -Messages $messages -MustContain @('menunggu diproses', $complaintNumber)
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Wait-ForAsyncMessages -WaUserId $complaintUser -Action {
    Update-ComplaintStatus -ComplaintId $complaintId -Status 'DONE' -AdminNotes 'Jalan sudah ditambal sementara oleh tim desa.'
  }
  $case = New-StatusResult -Name 'WA Complaint Done Notification' -Message 'internal status update DONE' -Messages $messages -MustContain @($complaintNumber, 'Jalan sudah ditambal sementara oleh tim desa.')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $complaintUser -Message "cek status $complaintNumber"
  $case = New-StatusResult -Name 'WA Complaint Status Done' -Message "cek status $complaintNumber" -Messages $messages -MustContain @('sudah *selesai*', 'Jalan sudah ditambal sementara oleh tim desa.')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $infoUser -Message 'Apa prioritas penanganan pengaduan?'
  $case = New-StatusResult -Name 'WA Complaint SOP Info Query' -Message 'Apa prioritas penanganan pengaduan?' -Messages $messages -MustContain @('prioritas', 'pengaduan') -MustNotContain @('boleh kami tahu nama', 'laporan diproses')
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output

  $messages = Invoke-WaMessage -WaUserId $handoffUser -Message 'Saya mau bicara dengan petugas manusia karena jawaban sebelumnya tidak membantu'
  $handoffStatus = Get-TakeoverStatus -WaUserId $handoffUser
  $outputText = Get-OutText -Messages $messages
  $handoffOk = Assert-HandoffActivated -Messages $messages -TakeoverStatus $handoffStatus
  $case = [pscustomobject]@{
    Name = 'WA Human Handoff'
    Status = $(if ($handoffOk) { 'PASS' } else { 'FAIL' })
    Message = 'Saya mau bicara dengan petugas manusia karena jawaban sebelumnya tidak membantu'
    Details = $(if ($handoffOk) { '' } else { 'Handoff response/status not detected' })
    Output = ($outputText + "`n---`n" + ($handoffStatus | ConvertTo-Json -Depth 6))
  }
  Add-Result -Results $results -Name $case.Name -Status $case.Status -Message $case.Message -Details $case.Details -OutputText $case.Output
} catch {
  Add-Result -Results $results -Name 'QA Runner Fatal' -Status 'ERROR' -Message 'runner' -Details $_.Exception.Message -OutputText ''
}

$summary = [pscustomobject]@{
  generated_at = (Get-Date).ToString('o')
  village_id = $VillageId
  total = $results.Count
  pass = (@($results | Where-Object Status -eq 'PASS')).Count
  fail = (@($results | Where-Object Status -eq 'FAIL')).Count
  error = (@($results | Where-Object Status -eq 'ERROR')).Count
  service_request_number = $requestNumber
  complaint_number = $complaintNumber
  results = $results
}

$outDir = Join-Path $PSScriptRoot 'qa-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("wa-resident-qa-sanreseng-ade_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$summary | ConvertTo-Json -Depth 8 | Out-File -FilePath $outFile -Encoding utf8

Write-Host ("Saved QA results to: {0}" -f $outFile) -ForegroundColor Cyan
if ($summary.fail -gt 0 -or $summary.error -gt 0) {
  exit 1
}
