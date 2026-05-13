param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$InternalApiKey = "govconnect-internal-api-key-2025",
  [string]$VillageId = "cmkuvo1dk0000mj60h4u4bq1w",
  [string]$SessionPrefix = "web_ai_qa",
  [int]$Retries = 2,
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = 'Stop'

function New-WebchatBody {
  param([string]$SessionId, [string]$VillageId, [string]$Message)
  return (@{ session_id = $SessionId; village_id = $VillageId; message = $Message } | ConvertTo-Json -Compress)
}

function Invoke-Webchat {
  param([string]$Message, [string]$SessionId)
  $uri = "$BaseUrl/api/webchat"
  $headers = @{ 'x-internal-api-key' = $InternalApiKey }
  $body = New-WebchatBody -SessionId $SessionId -VillageId $VillageId -Message $Message
  for ($attempt = 1; $attempt -le ($Retries + 1); $attempt++) {
    try {
      return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec $TimeoutSec
    } catch {
      if ($attempt -gt $Retries) { throw }
      Start-Sleep -Milliseconds (500 * $attempt)
    }
  }
}

function Assert-Contains([string]$Text, [string[]]$Needles) {
  foreach ($n in ($Needles | Where-Object { $_ -and $_.Trim() })) {
    if ($Text -notlike "*$n*") { return "Missing substring: '$n'" }
  }
  return $null
}
function Assert-NotContains([string]$Text, [string[]]$Needles) {
  foreach ($n in ($Needles | Where-Object { $_ -and $_.Trim() })) {
    if ($Text -like "*$n*") { return "Found forbidden: '$n'" }
  }
  return $null
}

# =============================================================================
# GROUP 1 — Knowledge Retrieval Accuracy (Single-turn)
# Test: RAG + embed + rerank bekerja untuk variasi query dari kategori berbeda
# =============================================================================
$groupKnowledge = @(
  @{ Id='KNO-001'; Name='FAQ: Salah pilih layanan'; Msg='Saya salah pilih layanan, apa yang harus dilakukan?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('ubah layanan'); MustNotContain=@('error') }
  @{ Id='KNO-002'; Name='SOP: Checklist pengaduan'; Msg='Apa saja yang perlu disertakan saat melapor pengaduan?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('Lokasi','Waktu'); MustNotContain=@() }
  @{ Id='KNO-003'; Name='Panduan: Format file digital'; Msg='File apa saja yang diterima untuk upload dokumen?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('PDF','JPG'); MustNotContain=@() }
  @{ Id='KNO-004'; Name='Profil desa: dusun'; Msg='Apa saja dusun di desa Sanreseng Ade?'; Intent=@('KNOWLEDGE_QUERY','AGENT','VILLAGE_PROFILE'); MustContain=@('Dusun'); MustNotContain=@() }
  @{ Id='KNO-005'; Name='Data policy: keamanan data'; Msg='Bagaimana keamanan data pribadi saya?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('admin'); MustNotContain=@() }
  @{ Id='KNO-006'; Name='Glosarium: LAP vs LAY'; Msg='Apa perbedaan nomor LAP dan LAY?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('LAP','LAY'); MustNotContain=@() }
  @{ Id='KNO-007'; Name='Alur status: OPEN ke DONE'; Msg='Status DONE pada pengaduan artinya apa?'; Intent=@('KNOWLEDGE_QUERY','AGENT','HISTORY','CHECK_STATUS'); MustContain=@(); MustNotContain=@() }
)

# =============================================================================
# GROUP 2 — Service Info (intent SERVICE_INFO, not creating)
# =============================================================================
$groupServiceInfo = @(
  @{ Id='SVC-001'; Name='List layanan'; Msg='Apa saja layanan yang tersedia di desa?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY'); MustContain=@('KTP'); MustNotContain=@() }
  @{ Id='SVC-002'; Name='Spesifik: KTP'; Msg='Bagaimana cara mengurus pengantar KTP?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('KTP'); MustNotContain=@() }
  @{ Id='SVC-003'; Name='Spesifik: SKU'; Msg='Saya butuh surat keterangan usaha'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('usaha'); MustNotContain=@() }
  @{ Id='SVC-004'; Name='Kategori: pindah'; Msg='Layanan apa untuk pindah rumah?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('Pindah'); MustNotContain=@() }
)

# =============================================================================
# GROUP 3 — Complaint Intent (bukan create, hanya deteksi intent)
# =============================================================================
$groupComplaint = @(
  @{ Id='CPL-001'; Name='Lapor jalan rusak'; Msg='Mau lapor jalan rusak di dusun Wakke'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT'); MustContain=@(); MustNotContain=@() }
  @{ Id='CPL-002'; Name='Sampah menumpuk'; Msg='Sampah menumpuk di depan rumah saya sudah 3 hari'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
  @{ Id='CPL-003'; Name='Lampu jalan mati'; Msg='Lampu jalan di depan mesjid mati semua'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT'); MustContain=@(); MustNotContain=@() }
)

# =============================================================================
# GROUP 4 — Status Check
# =============================================================================
$groupStatus = @(
  @{ Id='STA-001'; Name='Cek LAP valid format'; Msg='cek status LAP-20260425-007'; Intent=@('CHECK_STATUS','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='STA-002'; Name='Cek LAP tidak ada'; Msg='status LAP-99999999-999'; Intent=@('CHECK_STATUS','AGENT','KNOWLEDGE_QUERY'); MustContain=@('tidak'); MustNotContain=@() }
  @{ Id='STA-003'; Name='Cek LAY valid format'; Msg='cek status layanan LAY-20260425-007'; Intent=@('CHECK_STATUS','AGENT'); MustContain=@(); MustNotContain=@() }
)

# =============================================================================
# GROUP 5 — Edge Cases: typo, slang, bahasa daerah
# =============================================================================
$groupEdge = @(
  @{ Id='EDG-001'; Name='Typo: buat ktp'; Msg='gmn cara bikin ktp?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('KTP'); MustNotContain=@() }
  @{ Id='EDG-002'; Name='Singkatan: SKU'; Msg='proses SKU brp lama?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='EDG-003'; Name='Ambigu: nikah'; Msg='nikah'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT','SMALL_TALK'); MustContain=@(); MustNotContain=@() }
  @{ Id='EDG-004'; Name='Greeting'; Msg='halo'; Intent=@('SMALL_TALK','GREETING','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='EDG-005'; Name='Out-of-scope: resep makanan'; Msg='resep rendang padang'; Intent=@('KNOWLEDGE_QUERY','SMALL_TALK','AGENT','OUT_OF_SCOPE'); MustContain=@(); MustNotContain=@() }
)

# =============================================================================
# GROUP 6 — Multi-turn Context/Memory
# Test: session yang sama, pertanyaan lanjutan harus pakai context prior
# =============================================================================
$groupMemory = @(
  @{
    Id='MEM-001'
    Name='Multi-turn: KTP flow'
    Turns = @(
      @{ Msg='saya mau bikin ktp'; MustContain=@('KTP') }
      @{ Msg='apa saja syaratnya?'; MustContain=@() }  # Harus tetap tentang KTP
      @{ Msg='berapa lama prosesnya?'; MustContain=@() }
    )
  }
  @{
    Id='MEM-002'
    Name='Multi-turn: Pengaduan flow'
    Turns = @(
      @{ Msg='lapor jalan rusak'; MustContain=@() }
      @{ Msg='di dusun Jangkali'; MustContain=@() }   # Klarifikasi lokasi
      @{ Msg='sudah seminggu'; MustContain=@() }      # Klarifikasi waktu
    )
  }
)

$results = [System.Collections.Generic.List[object]]::new()
$started = Get-Date

function Run-SingleCase($t, $group) {
  $sid = "${SessionPrefix}_${group}_$($t.Id)_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
  $status = 'PASS'; $details = ''; $intent = ''; $ms = $null; $resp = ''
  try {
    $r = Invoke-Webchat -Message $t.Msg -SessionId $sid
    $intent = [string]$r.intent
    $resp = [string]$r.response
    $ms = $r.metadata.processingTimeMs

    if (-not $r.success) { $status='FAIL'; $details='success=false' }

    if ($status -eq 'PASS' -and $t.Intent) {
      $expected = if ($t.Intent -is [array]) { $t.Intent } else { @($t.Intent) }
      if ($expected -notcontains $intent) {
        $status='FAIL'; $details="Intent got '$intent', expected one of: $($expected -join ',')"
      }
    }

    if ($status -eq 'PASS' -and $t.MustContain.Count -gt 0) {
      $err = Assert-Contains -Text $resp -Needles $t.MustContain
      if ($err) { $status='FAIL'; $details=$err }
    }
    if ($status -eq 'PASS' -and $t.MustNotContain.Count -gt 0) {
      $err = Assert-NotContains -Text $resp.ToLowerInvariant() -Needles ($t.MustNotContain | ForEach-Object { $_.ToLowerInvariant() })
      if ($err) { $status='FAIL'; $details=$err }
    }
  } catch {
    $status='ERROR'; $details=$_.Exception.Message
  }

  $results.Add([pscustomobject]@{
    Group=$group; Id=$t.Id; Name=$t.Name; Status=$status; Intent=$intent; Ms=$ms;
    Details=$details; Message=$t.Msg; Response=(($resp -replace "\s+"," ").Trim())
  }) | Out-Null

  $color = if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'FAIL') { 'Yellow' } else { 'Red' }
  Write-Host ("[$group] $($t.Id) $($t.Name) => $status ($intent, ${ms}ms)") -ForegroundColor $color
  if ($status -ne 'PASS') { Write-Host "    $details" -ForegroundColor DarkGray }
}

function Run-MultiTurn($t, $group) {
  $sid = "${SessionPrefix}_${group}_$($t.Id)_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
  $turnIdx = 0
  foreach ($turn in $t.Turns) {
    $turnIdx++
    $status='PASS'; $details=''; $intent=''; $ms=$null; $resp=''
    try {
      $r = Invoke-Webchat -Message $turn.Msg -SessionId $sid
      $intent = [string]$r.intent
      $resp = [string]$r.response
      $ms = $r.metadata.processingTimeMs
      if (-not $r.success) { $status='FAIL'; $details='success=false' }
      if ($status -eq 'PASS' -and $turn.MustContain.Count -gt 0) {
        $err = Assert-Contains -Text $resp -Needles $turn.MustContain
        if ($err) { $status='FAIL'; $details=$err }
      }
    } catch {
      $status='ERROR'; $details=$_.Exception.Message
    }

    $results.Add([pscustomobject]@{
      Group=$group; Id="$($t.Id)-t$turnIdx"; Name="$($t.Name) (turn $turnIdx)"; Status=$status;
      Intent=$intent; Ms=$ms; Details=$details; Message=$turn.Msg;
      Response=(($resp -replace "\s+"," ").Trim())
    }) | Out-Null

    $color = if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'FAIL') { 'Yellow' } else { 'Red' }
    Write-Host ("[$group] $($t.Id)-t$turnIdx $($t.Name) turn $turnIdx => $status ($intent, ${ms}ms)") -ForegroundColor $color
    if ($status -ne 'PASS') { Write-Host "    $details" -ForegroundColor DarkGray }
  }
}

Write-Host "=== GROUP 1: Knowledge Retrieval ($($groupKnowledge.Count) cases) ===" -ForegroundColor Cyan
foreach ($t in $groupKnowledge) { Run-SingleCase $t 'KNOWLEDGE' }

Write-Host "`n=== GROUP 2: Service Info ($($groupServiceInfo.Count) cases) ===" -ForegroundColor Cyan
foreach ($t in $groupServiceInfo) { Run-SingleCase $t 'SERVICE' }

Write-Host "`n=== GROUP 3: Complaint Intent ($($groupComplaint.Count) cases) ===" -ForegroundColor Cyan
foreach ($t in $groupComplaint) { Run-SingleCase $t 'COMPLAINT' }

Write-Host "`n=== GROUP 4: Status Check ($($groupStatus.Count) cases) ===" -ForegroundColor Cyan
foreach ($t in $groupStatus) { Run-SingleCase $t 'STATUS' }

Write-Host "`n=== GROUP 5: Edge Cases ($($groupEdge.Count) cases) ===" -ForegroundColor Cyan
foreach ($t in $groupEdge) { Run-SingleCase $t 'EDGE' }

Write-Host "`n=== GROUP 6: Multi-turn Memory ($($groupMemory.Count) flows) ===" -ForegroundColor Cyan
foreach ($t in $groupMemory) { Run-MultiTurn $t 'MEMORY' }

$ended = Get-Date
$elapsed = New-TimeSpan -Start $started -End $ended
$pass = ($results | Where-Object Status -eq 'PASS').Count
$fail = ($results | Where-Object Status -eq 'FAIL').Count
$err  = ($results | Where-Object Status -eq 'ERROR').Count
$total = $results.Count

Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "Total: $total | PASS: $pass | FAIL: $fail | ERROR: $err | Duration: $($elapsed.ToString())"
$results | Group-Object Group | ForEach-Object {
  $gpass = ($_.Group | Where-Object Status -eq 'PASS').Count
  $gtotal = $_.Group.Count
  Write-Host ("  $($_.Name.PadRight(12)): $gpass/$gtotal PASS")
}

$outDir = Join-Path $PSScriptRoot 'qa-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("ai-intelligence-sanreseng-ade_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$results | ConvertTo-Json -Depth 6 | Out-File -FilePath $outFile -Encoding utf8
Write-Host "`nSaved: $outFile" -ForegroundColor Cyan

if (($fail + $err) -gt 0) { exit 1 } else { exit 0 }
