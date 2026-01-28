param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$InternalApiKey = "govconnect-internal-api-key-2025",
  [string]$VillageId = "cmkuvo1dk0000mj60h4u4bq1w",
  [string]$SessionPrefix = "web_qa",
  [int]$Retries = 3,
  [int]$TimeoutSec = 60,
  [switch]$StabilityProbe
)

$ErrorActionPreference = 'Stop'

function New-WebchatBodyJson {
  param(
    [string]$SessionId,
    [string]$VillageId,
    [string]$Message
  )

  return (@{
    session_id = $SessionId
    village_id = $VillageId
    message    = $Message
  } | ConvertTo-Json -Compress)
}

function Invoke-Webchat {
  param(
    [string]$Message,
    [string]$SessionId
  )

  $uri = "$BaseUrl/api/webchat"
  $headers = @{ 'x-internal-api-key' = $InternalApiKey }
  $bodyJson = New-WebchatBodyJson -SessionId $SessionId -VillageId $VillageId -Message $Message

  for ($attempt = 1; $attempt -le ($Retries + 1); $attempt++) {
    try {
      $result = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body $bodyJson -TimeoutSec $TimeoutSec
      return $result
    } catch {
      if ($attempt -gt $Retries) { throw }
      Start-Sleep -Milliseconds (250 * $attempt)
    }
  }
}

function Assert-Contains {
  param(
    [string]$Text,
    [string[]]$Needles
  )
  foreach ($needle in ($Needles | Where-Object { $_ -and $_.Trim().Length -gt 0 })) {
    if ($Text -notlike "*$needle*") {
      return "Missing expected substring: '$needle'"
    }
  }
  return $null
}

function Assert-NotContains {
  param(
    [string]$Text,
    [string[]]$Needles
  )
  foreach ($needle in ($Needles | Where-Object { $_ -and $_.Trim().Length -gt 0 })) {
    if ($Text -like "*$needle*") {
      return "Found forbidden substring: '$needle'"
    }
  }
  return $null
}

$commonMustNotContain = @(
  'margahayu',
  'https://govconnect.my.id/form/margahayu',
  'govconnect.my.id/form/margahayu'
)

$tests = @(
  # --- Office info (deterministic from DB) ---
  @{ Name = 'Office Address'; Message = 'Alamat kantor desa?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Google Maps'); MustNotContain=$commonMustNotContain; AllowLinks=$true },
  @{ Name = 'Office Hours Friday'; Message = 'Jam operasional hari Jumat?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Jumat','08:00'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Office Contact Service'; Message = 'Nomor WA pelayanan desa?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('+62'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: basics ---
  @{ Name = 'How to use GovConnect'; Message = 'Gimana cara menggunakan GovConnect lewat WA/Webchat?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('layanan','pengaduan'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Recommended service message format'; Message = 'Contoh format pesan yang direkomendasikan untuk layanan apa?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Saya ingin','Nama'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = '5W1H guidance'; Message = 'Apa itu prinsip 5W1H untuk laporan?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('What','Where','When'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Status & notification flow'; Message = 'Jelaskan status layanan/pengaduan dan notifikasinya' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('baru','proses'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: SOP pengaduan ---
  @{ Name = 'Complaint checklist'; Message = 'Checklist laporan pengaduan yang berkualitas apa saja?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Lokasi','Waktu'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Example of good complaint'; Message = 'Contoh laporan pengaduan yang baik seperti apa?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Baik'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Complaint priority'; Message = 'Apa prioritas penanganan pengaduan?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Tinggi','Sedang','Rendah'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: pelayanan publik ---
  @{ Name = 'Public service channels'; Message = 'Apa saja kanal pelayanan publik digital?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('WA','Webchat'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Public service stages'; Message = 'Tahap layanan umum itu apa saja?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('Pengajuan','Verifikasi'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: berkas digital ---
  @{ Name = 'Digital file formats'; Message = 'Format file apa yang diterima?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('PDF','JPG','PNG'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'If file too big'; Message = 'Kalau file terlalu besar gimana?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('kompres'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'File naming'; Message = 'Contoh penamaan file yang benar gimana?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('NIK_'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: FAQ ---
  @{ Name = 'Wrong service chosen'; Message = 'Saya salah pilih layanan, bagaimana?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('ubah layanan'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Update submitted data'; Message = 'Bagaimana memperbarui data yang sudah terkirim?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('ubah data'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Check status instruction'; Message = 'Bagaimana cek status layanan/pengaduan?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('cek status'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: glossary ---
  @{ Name = 'What is LAY'; Message = 'Apa itu nomor layanan LAY-...?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('LAY-'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'What is embedding'; Message = 'Apa itu embedding?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('vektor'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Seeded KB: data policy ---
  @{ Name = 'Data usage purpose'; Message = 'Untuk apa data saya digunakan di layanan digital?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('proses layanan'); MustNotContain=$commonMustNotContain; AllowLinks=$false },
  @{ Name = 'Data security policy'; Message = 'Bagaimana keamanan data saya?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('admin'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Status check deterministic ---
  @{ Name = 'Check status LAP (not found)'; Message = 'cek status LAP-20260115-001' ; ExpectIntent = 'CHECK_STATUS'; MustContain=@('tidak'); MustNotContain=$commonMustNotContain; AllowLinks=$false },

  # --- Out-of-KB (must not hallucinate) ---
  @{ Name = 'Out of KB area size'; Message = 'Berapa luas wilayah desa Sanreseng Ade?' ; ExpectIntent = 'KNOWLEDGE_QUERY'; MustContain=@('belum'); MustNotContain=($commonMustNotContain + @('km2','hektar')); AllowLinks=$false }
)

$results = New-Object System.Collections.Generic.List[object]
$started = Get-Date

Write-Host "Running QA for VillageId=$VillageId at $BaseUrl" -ForegroundColor Cyan

$idx = 0
foreach ($t in $tests) {
  $idx++
  $sessionId = "${SessionPrefix}_${idx}_$([Guid]::NewGuid().ToString('N').Substring(0,8))"
  $name = $t.Name
  $message = $t.Message

  $status = 'PASS'
  $details = ''
  $intent = ''
  $processingMs = $null
  $responseText = ''

  try {
    $resp = Invoke-Webchat -Message $message -SessionId $sessionId
    $intent = $resp.intent
    $responseText = [string]$resp.response
    $processingMs = $resp.metadata.processingTimeMs

    if (-not $resp.success) {
      $status = 'FAIL'
      $details = 'success=false'
    }

    if ($status -eq 'PASS' -and $t.ExpectIntent -and $intent -ne $t.ExpectIntent) {
      $status = 'FAIL'
      $details = "Intent mismatch: got '$intent', expected '$($t.ExpectIntent)'"
    }

    if ($status -eq 'PASS') {
      $err = Assert-Contains -Text $responseText -Needles $t.MustContain
      if ($err) { $status = 'FAIL'; $details = $err }
    }

    if ($status -eq 'PASS') {
      $err = Assert-NotContains -Text $responseText.ToLowerInvariant() -Needles ($t.MustNotContain | ForEach-Object { $_.ToLowerInvariant() })
      if ($err) { $status = 'FAIL'; $details = $err }
    }

    if ($status -eq 'PASS' -and (-not $t.AllowLinks)) {
      if ($responseText -match 'https?://') {
        $status = 'FAIL'
        $details = 'Response contains a link but AllowLinks=false'
      }
    }
  } catch {
    $status = 'ERROR'
    $details = $_.Exception.Message
  }

  $results.Add([pscustomobject]@{
    Index = $idx
    Name = $name
    Status = $status
    Intent = $intent
    ProcessingMs = $processingMs
    Details = $details
    Message = $message
    Response = ($responseText -replace "\s+"," ").Trim()
  }) | Out-Null

  $color = if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'FAIL') { 'Yellow' } else { 'Red' }
  Write-Host ("[{0}/{1}] {2} => {3} ({4})" -f $idx, $tests.Count, $name, $status, $intent) -ForegroundColor $color
}

if ($StabilityProbe) {
  Write-Host "\nStability probe: 30 quick calls (retry enabled)" -ForegroundColor Cyan
  $ok = 0
  $errCount = 0
  for ($i = 1; $i -le 30; $i++) {
    try {
      $sid = "${SessionPrefix}_stab_${i}_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
      $r = Invoke-Webchat -Message 'Format file apa yang diterima?' -SessionId $sid
      if ($r -and $r.success) { $ok++ } else { $errCount++ }
    } catch { $errCount++ }
  }
  Write-Host ("Stability probe results: OK={0}, ERR={1}" -f $ok, $errCount) -ForegroundColor Cyan
}

$ended = Get-Date
$elapsed = New-TimeSpan -Start $started -End $ended

$pass = ($results | Where-Object Status -eq 'PASS').Count
$fail = ($results | Where-Object Status -eq 'FAIL').Count
$err = ($results | Where-Object Status -eq 'ERROR').Count

Write-Host "\nSummary: PASS=$pass FAIL=$fail ERROR=$err Duration=$($elapsed.ToString())" -ForegroundColor Cyan

$outDir = Join-Path $PSScriptRoot 'qa-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("webchat-qa-sanreseng-ade_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$results | ConvertTo-Json -Depth 6 | Out-File -FilePath $outFile -Encoding utf8
Write-Host "Saved detailed results to: $outFile" -ForegroundColor Cyan

# Exit non-zero if any fail/error
if (($fail + $err) -gt 0) { exit 1 } else { exit 0 }
