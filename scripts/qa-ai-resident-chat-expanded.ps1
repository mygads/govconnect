param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$InternalApiKey = "govconnect-internal-api-key-2025",
  [string]$VillageId = "cmkuvo1dk0000mj60h4u4bq1w",
  [string]$SessionPrefix = "web_resexp",
  [int]$Retries = 1,
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
    if ($Text -notlike "*$n*") { return "Missing: '$n'" }
  }
  return $null
}
function Assert-NotContains([string]$Text, [string[]]$Needles) {
  foreach ($n in ($Needles | Where-Object { $_ -and $_.Trim() })) {
    if ($Text -like "*$n*") { return "Found forbidden: '$n'" }
  }
  return $null
}

$results = [System.Collections.Generic.List[object]]::new()
$started = Get-Date

function Add-Result($group, $id, $name, $status, $intent, $ms, $details, $msg, $resp) {
  $results.Add([pscustomobject]@{
    Group=$group; Id=$id; Name=$name; Status=$status; Intent=$intent; Ms=$ms;
    Details=$details; Message=$msg; Response=(($resp -replace "\s+"," ").Trim())
  }) | Out-Null
  $color = if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'FAIL') { 'Yellow' } else { 'Red' }
  Write-Host ("[$group] $id $name => $status ($intent, ${ms}ms)") -ForegroundColor $color
  if ($status -ne 'PASS') { Write-Host "    $details" -ForegroundColor DarkGray }
}

function Run-Case($t, $group) {
  $rawPrefix = if ($SessionPrefix.StartsWith('web_')) { $SessionPrefix } else { "web_${SessionPrefix}" }
  $sid = "${rawPrefix}_${group}_$($t.Id)_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
  $maxAttempts = 2
  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $status = 'PASS'; $details = ''; $intent = ''; $ms = $null; $resp = ''
    try {
      $r = Invoke-Webchat -Message $t.Msg -SessionId $sid
      $intent = [string]$r.intent
      $resp = [string]$r.response
      $ms = $r.metadata.processingTimeMs
      if (-not $r.success) { $status='FAIL'; $details='success=false' }
      if ($status -eq 'PASS' -and $t.Intent) {
        $expected = if ($t.Intent -is [array]) { $t.Intent } else { @($t.Intent) }
        if ($expected -notcontains $intent) { $status='FAIL'; $details="Intent='$intent', expected: $($expected -join ',')" }
      }
      if ($status -eq 'PASS' -and $t.MustContain.Count -gt 0) {
        $err = Assert-Contains -Text $resp -Needles $t.MustContain
        if ($err) { $status='FAIL'; $details=$err }
      }
      if ($status -eq 'PASS' -and $t.MustNotContain.Count -gt 0) {
        $err = Assert-NotContains -Text $resp.ToLowerInvariant() -Needles ($t.MustNotContain | ForEach-Object { $_.ToLowerInvariant() })
        if ($err) { $status='FAIL'; $details=$err }
      }
      if ($status -eq 'PASS' -and $t.MaxMs -and $ms -gt $t.MaxMs) {
        $status='FAIL'; $details="Too slow: ${ms}ms > $($t.MaxMs)ms"
      }
    } catch {
      $status='ERROR'; $details=$_.Exception.Message
    }
    if ($status -eq 'PASS') { break }
    if ($attempt -lt $maxAttempts) {
      $sid = "${rawPrefix}_${group}_$($t.Id)_retry_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
      Start-Sleep -Seconds 2
    }
  }
  Add-Result $group $t.Id $t.Name $status $intent $ms $details $t.Msg $resp
}

$sessionPrefixForWebchat = if ($SessionPrefix.StartsWith('web_')) { $SessionPrefix } else { "web_${SessionPrefix}" }

# =============================================================================
# GROUP A: Daily Village Life (tanya sehari-hari warga)
# =============================================================================
Write-Host "`n=== GROUP A: Daily Village Life ===" -ForegroundColor Cyan
$ga = @(
  @{ Id='DV-001'; Name='Jam kantor desa'; Msg='kantor desa buka jam berapa?'; Intent=@('KNOWLEDGE_QUERY','AGENT','SERVICE_INFO','VILLAGE_PROFILE'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-002'; Name='Kepala desa'; Msg='siapa kepala desa Sanreseng Ade sekarang?'; Intent=@('KNOWLEDGE_QUERY','AGENT','VILLAGE_PROFILE'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-003'; Name='Alamat kantor desa'; Msg='alamat kantor desa di mana?'; Intent=@('KNOWLEDGE_QUERY','AGENT','VILLAGE_PROFILE'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-004'; Name='Kontak desa'; Msg='nomor telepon kantor desa berapa?'; Intent=@('KNOWLEDGE_QUERY','AGENT','CONTACT_DIRECTORY','VILLAGE_PROFILE'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-005'; Name='Biaya layanan'; Msg='apakah ada biaya untuk mengurus surat domisili?'; Intent=@('KNOWLEDGE_QUERY','AGENT','SERVICE_INFO'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-006'; Name='Layanan hari sabtu'; Msg='apakah pelayanan hari sabtu buka?'; Intent=@('KNOWLEDGE_QUERY','AGENT','SERVICE_INFO','VILLAGE_PROFILE'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-007'; Name='Jadwal BLT'; Msg='kapan jadwal pembagian BLT?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='DV-008'; Name='Daftar BPJS'; Msg='bagaimana cara daftar BPJS atau KIS?'; Intent=@('KNOWLEDGE_QUERY','AGENT','SERVICE_INFO'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $ga) { Run-Case $t 'DV' }

# =============================================================================
# GROUP B: Additional Services (layanan yang belum dites)
# =============================================================================
Write-Host "`n=== GROUP B: Additional Services ===" -ForegroundColor Cyan
$gb = @(
  @{ Id='AS-001'; Name='KK'; Msg='saya mau bikin Kartu Keluarga baru'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='AS-002'; Name='Akta lahir'; Msg='bagaimana cara mengurus akta kelahiran anak saya?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='AS-003'; Name='SKTM'; Msg='saya butuh surat keterangan tidak mampu untuk anak sekolah'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='AS-004'; Name='Akta kematian'; Msg='keluarga saya meninggal, bagaimana urus akta kematiannya?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='AS-005'; Name='Pindah masuk'; Msg='saya baru pindah ke desa ini, urus pindah masuk bagaimana?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('Pindah'); MustNotContain=@() }
  @{ Id='AS-006'; Name='Domisili detail'; Msg='apa saja syarat surat keterangan domisili?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $gb) { Run-Case $t 'AS' }

# =============================================================================
# GROUP C: Complaint Edge Cases (keluhan lanjut, eskalasi, anonim)
# =============================================================================
Write-Host "`n=== GROUP C: Complaint Edge Cases ===" -ForegroundColor Cyan
$gc = @(
  @{ Id='CE-001'; Name='Laporan belum ditanggapi'; Msg='saya sudah melapor jalan rusak 2 minggu lalu tapi belum diperbaiki'; Intent=@('COMPLAINT','AGENT','CHECK_STATUS','CREATE_COMPLAINT','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
  @{ Id='CE-002'; Name='Eskalasi 30 hari'; Msg='laporan saya tidak ada kabar sudah 30 hari apakah bisa dinaikkan?'; Intent=@('AGENT','CHECK_STATUS','COMPLAINT','KNOWLEDGE_QUERY','HISTORY'); MustContain=@(); MustNotContain=@() }
  @{ Id='CE-003'; Name='Batalkan laporan'; Msg='saya mau membatalkan laporan saya yang kemarin'; Intent=@('AGENT','CANCEL','CANCEL_REQUEST','CHECK_STATUS','KNOWLEDGE_QUERY','HISTORY'); MustContain=@(); MustNotContain=@() }
  @{ Id='CE-004'; Name='Laporan anonim'; Msg='apakah saya bisa lapor tanpa nama?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='CE-005'; Name='Status progress'; Msg='sudah sampai mana pengaduan LAP-20260425-007?'; Intent=@('CHECK_STATUS','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='CE-006'; Name='Complaint detail rambling'; Msg='pak jalan depan rumah saya rusak sudah lama, banyak lubang, setiap kali hujan airnya tergenang dan bahaya untuk motor, mohon diperbaiki segera karena sudah banyak warga yang hampir jatuh'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $gc) { Run-Case $t 'CE' }

# =============================================================================
# GROUP D: Out-of-Scope / Boundary (pertanyaan yang di luar cakupan desa)
# =============================================================================
Write-Host "`n=== GROUP D: Out-of-Scope Boundary ===" -ForegroundColor Cyan
$gd = @(
  @{ Id='OS-001'; Name='Politik nasional'; Msg='siapa presiden Indonesia sekarang?'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@() }
  @{ Id='OS-002'; Name='Medis'; Msg='saya sakit kepala, obat apa yang bagus?'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@('paracetamol','ibuprofen') }
  @{ Id='OS-003'; Name='Hukum personal'; Msg='saya ditipu orang, bagaimana cara lapor polisi?'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY','EMERGENCY_CONTACTS','QUESTION'); MustContain=@(); MustNotContain=@() }
  @{ Id='OS-004'; Name='Transaksi finansial'; Msg='tolong transfer uang ke rekening BRI 1234567890'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@('berhasil','sukses ditransfer','telah dikirim') }
  @{ Id='OS-005'; Name='Gosip/rumor'; Msg='benar tidak ada razia Kamis ini?'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $gd) { Run-Case $t 'OS' }

# =============================================================================
# GROUP E: Input Edge Cases (input aneh, kasar, kosong)
# =============================================================================
Write-Host "`n=== GROUP E: Input Edge Cases ===" -ForegroundColor Cyan
$ge = @(
  @{ Id='IE-001'; Name='All caps marah'; Msg='HARGAI WARGA! KAPAN JALAN DIBENARKAN!?'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@() }
  @{ Id='IE-002'; Name='Pesan sangat pendek'; Msg='ok'; Intent=@('SMALL_TALK','GRATITUDE','AGENT','GREETING','QUESTION','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
  @{ Id='IE-003'; Name='Pesan emoji saja'; Msg=([char]0xD83D + [char]0xDC4D); Intent=@('SMALL_TALK','GRATITUDE','AGENT','GREETING','QUESTION','KNOWLEDGE_QUERY','SPAM'); MustContain=@(); MustNotContain=@() }
  @{ Id='IE-004'; Name='Pesan sangat panjang'; Msg=('assalamualaikum pak saya warga dusun wakke mau tanya tentang banyak hal sekaligus, pertama soal KTP saya yang sudah lama habis masa berlakunya dan perlu diperbarui, kedua anak saya mau sekolah dan butuh surat keterangan tidak mampu, ketiga di depan rumah saya ada jalan rusak yang sudah lama tidak diperbaiki, keempat saya juga mau tanya apakah ada bantuan sosial bulan ini, mohon info lengkapnya'); Intent=@('AGENT','SERVICE_INFO','KNOWLEDGE_QUERY','COMPLAINT'); MustContain=@(); MustNotContain=@() }
  @{ Id='IE-005'; Name='Pesan nomor asal'; Msg='1234567890'; Intent=@('AGENT','QUESTION','CHECK_STATUS','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $ge) { Run-Case $t 'IE' }

# =============================================================================
# GROUP F: Multi-turn Context Memory (percakapan bersambung)
# =============================================================================
Write-Host "`n=== GROUP F: Multi-turn Context Memory ===" -ForegroundColor Cyan

# F1: Ganti topik di tengah (interrupt service flow)
$sid_f1 = "${sessionPrefixForWebchat}_MTX1_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
$f1Turns = @(
  @{ Msg='mau urus surat pindah'; MustContain=@(); Name='pindah request' }
  @{ Msg='eh sebentar dulu, saya mau lapor jalan rusak di dusun Wakke'; MustContain=@(); Name='interrupt to complaint' }
  @{ Msg='oke lanjut surat pindahnya'; MustContain=@(); Name='resume pindah' }
)
$turnIdx = 0
foreach ($turn in $f1Turns) {
  $turnIdx++
  $status='PASS'; $details=''; $intent=''; $ms=$null; $resp=''
  try {
    $r = Invoke-Webchat -Message $turn.Msg -SessionId $sid_f1
    $intent = [string]$r.intent; $resp = [string]$r.response; $ms = $r.metadata.processingTimeMs
    if (-not $r.success) { $status='FAIL'; $details='success=false' }
  } catch { $status='ERROR'; $details=$_.Exception.Message }
  Add-Result 'MTX' "MTX1-t$turnIdx" "Interrupt flow: $($turn.Name)" $status $intent $ms $details $turn.Msg $resp
}

# F2: Ingat nama yang diberi
$sid_f2 = "${sessionPrefixForWebchat}_MTX2_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
$f2Turns = @(
  @{ Msg='halo, nama saya Budi Santoso'; MustContain=@() }
  @{ Msg='saya mau bikin SKTM'; MustContain=@() }
  @{ Msg='siapa nama saya tadi?'; MustContain=@('Budi') }
)
$turnIdx = 0
foreach ($turn in $f2Turns) {
  $turnIdx++
  $status='PASS'; $details=''; $intent=''; $ms=$null; $resp=''
  try {
    $r = Invoke-Webchat -Message $turn.Msg -SessionId $sid_f2
    $intent = [string]$r.intent; $resp = [string]$r.response; $ms = $r.metadata.processingTimeMs
    if (-not $r.success) { $status='FAIL'; $details='success=false' }
    if ($status -eq 'PASS' -and $turn.MustContain.Count -gt 0) {
      $err = Assert-Contains -Text $resp -Needles $turn.MustContain
      if ($err) { $status='FAIL'; $details=$err }
    }
  } catch { $status='ERROR'; $details=$_.Exception.Message }
  Add-Result 'MTX' "MTX2-t$turnIdx" "Remember name turn $turnIdx" $status $intent $ms $details $turn.Msg $resp
}

# F3: Follow-up pronomina
$sid_f3 = "${sessionPrefixForWebchat}_MTX3_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
$f3Turns = @(
  @{ Msg='syarat KTP apa saja?'; MustContain=@() }
  @{ Msg='kalau itu sudah ada, berapa lama prosesnya?'; MustContain=@() }
  @{ Msg='bisa online tidak?'; MustContain=@() }
)
$turnIdx = 0
foreach ($turn in $f3Turns) {
  $turnIdx++
  $status='PASS'; $details=''; $intent=''; $ms=$null; $resp=''
  try {
    $r = Invoke-Webchat -Message $turn.Msg -SessionId $sid_f3
    $intent = [string]$r.intent; $resp = [string]$r.response; $ms = $r.metadata.processingTimeMs
    if (-not $r.success) { $status='FAIL'; $details='success=false' }
  } catch { $status='ERROR'; $details=$_.Exception.Message }
  Add-Result 'MTX' "MTX3-t$turnIdx" "Pronominal follow-up $turnIdx" $status $intent $ms $details $turn.Msg $resp
}

# =============================================================================
# GROUP G: Language / Style variation
# =============================================================================
Write-Host "`n=== GROUP G: Language / Style ===" -ForegroundColor Cyan
$gg = @(
  @{ Id='LS-001'; Name='Bahasa Inggris singkat'; Msg='hi, can I make a complaint here?'; Intent=@('GREETING','AGENT','KNOWLEDGE_QUERY','SMALL_TALK','QUESTION','COMPLAINT','CREATE_COMPLAINT'); MustContain=@(); MustNotContain=@() }
  @{ Id='LS-002'; Name='Sopan panjang'; Msg='assalamualaikum, mohon maaf mengganggu, saya ingin menanyakan prosedur pembuatan surat keterangan domisili, terima kasih sebelumnya'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='LS-003'; Name='Singkatan ekstrem'; Msg='bgm cra urs ktp yg lama hbs?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='LS-004'; Name='Campur daerah'; Msg='tabe pak, mauka tanya caranya urus kartu keluarga'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='LS-005'; Name='Bahasa kasar ringan'; Msg='udah berapa kali saya lapor tapi gak diurus-urus!'; Intent=@('AGENT','COMPLAINT','CHECK_STATUS','KNOWLEDGE_QUERY','CREATE_COMPLAINT','QUESTION'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $gg) { Run-Case $t 'LS' }

# =============================================================================
# GROUP H: No-Hallucination on Missing Data
# =============================================================================
Write-Host "`n=== GROUP H: No-Hallucination ===" -ForegroundColor Cyan
$gh = @(
  @{ Id='NH-101'; Name='Program tidak ada: lowongan'; Msg='apakah desa sedang buka lowongan kerja?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@('lowongan resmi desa','recruit') }
  @{ Id='NH-102'; Name='Tokoh tidak dikenal'; Msg='siapa Pak Amin Saputra di desa ini?'; Intent=@('AGENT','KNOWLEDGE_QUERY','VILLAGE_PROFILE','QUESTION'); MustContain=@(); MustNotContain=@() }
  @{ Id='NH-103'; Name='Tanggal palsu'; Msg='apakah benar ada acara 17 Juli nanti di balai desa?'; Intent=@('AGENT','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@('acara resmi','konfirmasi resmi') }
  @{ Id='NH-104'; Name='Kontak palsu'; Msg='nomor HP kepala desa berapa ya?'; Intent=@('AGENT','KNOWLEDGE_QUERY','CONTACT_DIRECTORY','VILLAGE_PROFILE','QUESTION'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $gh) { Run-Case $t 'NH' }

# =============================================================================
# SUMMARY
# =============================================================================
$ended = Get-Date
$elapsed = New-TimeSpan -Start $started -End $ended
$pass = ($results | Where-Object Status -eq 'PASS').Count
$fail = ($results | Where-Object Status -eq 'FAIL').Count
$err  = ($results | Where-Object Status -eq 'ERROR').Count
$total = $results.Count

Write-Host "`n=== RESIDENT EXPANDED AUDIT SUMMARY ===" -ForegroundColor Cyan
Write-Host "Total: $total | PASS: $pass | FAIL: $fail | ERROR: $err | Duration: $($elapsed.ToString())"
$results | Group-Object Group | ForEach-Object {
  $gpass = ($_.Group | Where-Object Status -eq 'PASS').Count
  $gtotal = $_.Group.Count
  Write-Host ("  $($_.Name.PadRight(12)): $gpass/$gtotal PASS")
}

$outDir = Join-Path $PSScriptRoot 'qa-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("ai-resident-chat-expanded_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$results | ConvertTo-Json -Depth 6 | Out-File -FilePath $outFile -Encoding utf8
Write-Host "`nSaved: $outFile" -ForegroundColor Cyan

if (($fail + $err) -gt 0) { exit 1 } else { exit 0 }
