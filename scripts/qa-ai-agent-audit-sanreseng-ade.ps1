param(
  [string]$BaseUrl = "http://localhost:3002",
  [string]$InternalApiKey = "govconnect-internal-api-key-2025",
  [string]$VillageId = "cmkuvo1dk0000mj60h4u4bq1w",
  [string]$SessionPrefix = "web_audit",
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

function Invoke-KnowledgeApi {
  param([string]$Method, [string]$Path, $Body = $null)
  $uri = "$BaseUrl/api/knowledge$Path"
  $headers = @{ 'x-internal-api-key' = $InternalApiKey; 'Content-Type' = 'application/json' }
  $params = @{ Method = $Method; Uri = $uri; Headers = $headers; TimeoutSec = 30 }
  if ($null -ne $Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 6 -Compress); $params['ContentType'] = 'application/json' }
  return Invoke-RestMethod @params
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
      Start-Sleep -Seconds 3
    }
  }
  Add-Result $group $t.Id $t.Name $status $intent $ms $details $t.Msg $resp
}

# =============================================================================
# GROUP 1: Knowledge Fidelity (DB-validated answers from KB)
# =============================================================================
Write-Host "`n=== GROUP 1: Knowledge Fidelity ===" -ForegroundColor Cyan
$g1 = @(
  @{ Id='KF-001'; Name='FAQ: salah pilih layanan'; Msg='Saya salah pilih layanan, apa yang harus dilakukan?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('ubah layanan'); MustNotContain=@() }
  @{ Id='KF-002'; Name='SOP: checklist pengaduan'; Msg='Apa saja yang perlu disertakan saat melapor pengaduan?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('okasi','aktu'); MustNotContain=@() }
  @{ Id='KF-003'; Name='Panduan: format file'; Msg='File apa saja yang diterima untuk upload dokumen?'; Intent=@('KNOWLEDGE_QUERY','AGENT','SERVICE_INFO'); MustContain=@('PDF','JPG'); MustNotContain=@() }
  @{ Id='KF-004'; Name='Profil desa: dusun'; Msg='Apa saja dusun di desa Sanreseng Ade?'; Intent=@('KNOWLEDGE_QUERY','AGENT','VILLAGE_PROFILE'); MustContain=@('usun'); MustNotContain=@() }
  @{ Id='KF-005'; Name='Kebijakan data'; Msg='Bagaimana keamanan data pribadi saya?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('admin'); MustNotContain=@() }
  @{ Id='KF-006'; Name='Glosarium: LAP vs LAY'; Msg='Apa perbedaan nomor LAP dan LAY?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('LAP','LAY'); MustNotContain=@() }
  @{ Id='KF-007'; Name='Alur status: DONE'; Msg='Status DONE pada pengaduan artinya apa?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='KF-008'; Name='5W1H'; Msg='Apa itu prinsip 5W1H untuk laporan?'; Intent=@('KNOWLEDGE_QUERY','AGENT'); MustContain=@('What','Where','When'); MustNotContain=@() }
)
foreach ($t in $g1) { Run-Case $t 'KF' }

# =============================================================================
# GROUP 2: Service Advisory (DB tool call, not KB)
# =============================================================================
Write-Host "`n=== GROUP 2: Service Advisory ===" -ForegroundColor Cyan
$g2 = @(
  @{ Id='SA-001'; Name='List layanan'; Msg='Apa saja layanan yang tersedia di desa?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY'); MustContain=@('KTP'); MustNotContain=@() }
  @{ Id='SA-002'; Name='KTP detail'; Msg='Bagaimana cara mengurus pengantar KTP?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('KTP'); MustNotContain=@() }
  @{ Id='SA-003'; Name='SKU'; Msg='Saya butuh surat keterangan usaha'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('usaha'); MustNotContain=@() }
  @{ Id='SA-004'; Name='Pindah'; Msg='Layanan apa untuk pindah rumah?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@('Pindah'); MustNotContain=@() }
  @{ Id='SA-005'; Name='Online vs offline'; Msg='Apakah KTP bisa diurus online lewat GovConnect?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $g2) { Run-Case $t 'SA' }

# =============================================================================
# GROUP 3: Complaint CRUD + Photo + Urgency
# =============================================================================
Write-Host "`n=== GROUP 3: Complaint CRUD ===" -ForegroundColor Cyan

# 3a: Single-turn complaint detection
$g3single = @(
  @{ Id='CC-001'; Name='Lapor jalan rusak'; Msg='Mau lapor jalan rusak di dusun Wakke'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT'); MustContain=@(); MustNotContain=@() }
  @{ Id='CC-002'; Name='Sampah menumpuk'; Msg='Sampah menumpuk di depan rumah saya sudah 3 hari'; Intent=@('COMPLAINT','AGENT','CREATE_COMPLAINT','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
  @{ Id='CC-003'; Name='Urgent: kebakaran'; Msg='Rumah tetangga saya kebakaran tolong!'; Intent=@('EMERGENCY_CONTACTS','AGENT','CREATE_COMPLAINT'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $g3single) { Run-Case $t 'CC' }

# 3b: Multi-turn complaint flow
$sessionPrefixForWebchat = if ($SessionPrefix.StartsWith('web_')) { $SessionPrefix } else { "web_${SessionPrefix}" }
$sid_complaint = "${sessionPrefixForWebchat}_CC_FLOW_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
$ccFlowTurns = @(
  @{ Msg='saya mau lapor lampu jalan mati'; MustContain=@() }
  @{ Msg='di depan masjid dusun Wakke'; MustContain=@() }
  @{ Msg='sudah 5 hari mati'; MustContain=@() }
)
$turnIdx = 0
foreach ($turn in $ccFlowTurns) {
  $turnIdx++
  $status='PASS'; $details=''; $intent=''; $ms=$null; $resp=''
  try {
    $r = Invoke-Webchat -Message $turn.Msg -SessionId $sid_complaint
    $intent = [string]$r.intent; $resp = [string]$r.response; $ms = $r.metadata.processingTimeMs
    if (-not $r.success) { $status='FAIL'; $details='success=false' }
    if ($status -eq 'PASS' -and $turn.MustContain.Count -gt 0) {
      $err = Assert-Contains -Text $resp -Needles $turn.MustContain
      if ($err) { $status='FAIL'; $details=$err }
    }
  } catch { $status='ERROR'; $details=$_.Exception.Message }
  Add-Result 'CC' "CC-FLOW-t$turnIdx" "Complaint flow turn $turnIdx" $status $intent $ms $details $turn.Msg $resp
}

# 3c: Status check
$g3status = @(
  @{ Id='CC-STA-001'; Name='Cek LAP valid'; Msg='cek status LAP-20260425-007'; Intent=@('CHECK_STATUS','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='CC-STA-002'; Name='Cek LAP not found'; Msg='status LAP-99999999-999'; Intent=@('CHECK_STATUS','AGENT','KNOWLEDGE_QUERY'); MustContain=@('tidak'); MustNotContain=@() }
)
foreach ($t in $g3status) { Run-Case $t 'CC' }

# =============================================================================
# GROUP 4: Admin Upload/Embed/Retrieval Pipeline
# =============================================================================
Write-Host "`n=== GROUP 4: Admin Embed Pipeline ===" -ForegroundColor Cyan

$testKbId = "test_audit_kb_$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$testKbContent = "Jadwal posyandu desa Sanreseng Ade dilaksanakan setiap hari Rabu minggu pertama dan ketiga setiap bulan, pukul 08.00-12.00 WITA di Balai Desa."
$testKbTitle = "Jadwal Posyandu Desa Sanreseng Ade"

$embedStatus = 'PASS'; $embedDetails = ''
try {
  # Step 1: Upload knowledge
  $uploadBody = @{
    id = $testKbId
    title = $testKbTitle
    content = $testKbContent
    category = 'custom'
    village_id = $VillageId
    keywords = @('posyandu','jadwal','balai desa')
  }
  $uploadResult = Invoke-KnowledgeApi -Method POST -Path '' -Body $uploadBody
  if ($uploadResult.status -ne 'success') { $embedStatus='FAIL'; $embedDetails='Upload failed' }
} catch { $embedStatus='ERROR'; $embedDetails="Upload: $($_.Exception.Message)" }
Add-Result 'EMBED' 'EMB-001' 'Upload knowledge entry' $embedStatus '' $null $embedDetails "POST /api/knowledge" ''

$getStatus = 'PASS'; $getDetails = ''
try {
  # Step 2: Verify it exists
  $getResult = Invoke-KnowledgeApi -Method GET -Path "/$testKbId"
  if (-not $getResult.data) { $getStatus='FAIL'; $getDetails='GET returned no data' }
} catch { $getStatus='ERROR'; $getDetails="GET: $($_.Exception.Message)" }
Add-Result 'EMBED' 'EMB-002' 'Verify knowledge exists' $getStatus '' $null $getDetails "GET /api/knowledge/$testKbId" ''

$searchStatus = 'PASS'; $searchDetails = ''
try {
  # Step 3: Vector search
  Start-Sleep -Seconds 2
  $searchBody = @{ query = 'jadwal posyandu kapan?'; topK = 5; minScore = 0.5; villageId = $VillageId }
  $searchResult = Invoke-KnowledgeApi -Method POST -Path '/search' -Body $searchBody
  $hits = @($searchResult.data)
  if ($hits.Count -eq 0) { $searchStatus='FAIL'; $searchDetails='No vector search hits' }
  else {
    $found = $hits | Where-Object { $_.content -like '*posyandu*' -or $_.title -like '*posyandu*' }
    if (-not $found) { $searchStatus='FAIL'; $searchDetails='Hit found but not matching posyandu content' }
  }
} catch { $searchStatus='ERROR'; $searchDetails="Search: $($_.Exception.Message)" }
Add-Result 'EMBED' 'EMB-003' 'Vector search finds new entry' $searchStatus '' $null $searchDetails "POST /api/knowledge/search" ''

# Step 4: Ask AI about the new content (embed is async — allow longer wait)
# Reset circuit breaker before this test to avoid cascading demotions from earlier slow calls
try {
  $env:PGPASSWORD = 'dbgovconnect2026'
  psql -h 127.0.0.1 -U govconnect -d govconnect -c "UPDATE ai.ai_provider_health SET consecutive_failures=0, demoted_until=NULL WHERE consecutive_failures > 0 OR demoted_until IS NOT NULL;" 2>&1 | Out-Null
} catch {}
$aiStatus = 'PASS'; $aiDetails = ''; $aiIntent = ''; $aiMs = $null; $aiResp = ''
try {
  Start-Sleep -Seconds 8
  $sid_embed = "${sessionPrefixForWebchat}_EMBED_AI_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
  $r = Invoke-Webchat -Message 'Kapan jadwal posyandu di desa?' -SessionId $sid_embed
  $aiIntent = [string]$r.intent; $aiResp = [string]$r.response; $aiMs = $r.metadata.processingTimeMs
  if (-not $r.success) { $aiStatus='FAIL'; $aiDetails='success=false' }
  if ($aiStatus -eq 'PASS') {
    $hasKeyword = ($aiResp -like '*posyandu*') -or ($aiResp -like '*Rabu*') -or ($aiResp -like '*Balai Desa*') -or ($aiResp -like '*minggu pertama*')
    if (-not $hasKeyword) {
      if ($aiResp -like '*membutuhkan waktu*' -or $aiResp -like '*coba lagi*') {
        $aiStatus='FAIL'; $aiDetails="AI timeout/fallback (circuit breaker): $($aiResp.Substring(0, [Math]::Min(80, $aiResp.Length)))"
      } else {
        $aiStatus='FAIL'; $aiDetails="AI answer missing posyandu/Rabu/Balai Desa keywords. Got: $($aiResp.Substring(0, [Math]::Min(120, $aiResp.Length)))"
      }
    }
  }
} catch { $aiStatus='ERROR'; $aiDetails="AI: $($_.Exception.Message)" }
Add-Result 'EMBED' 'EMB-004' 'AI answers from new KB entry' $aiStatus $aiIntent $aiMs $aiDetails 'Kapan jadwal posyandu di desa?' $aiResp

# Step 5: Cleanup
$delStatus = 'PASS'; $delDetails = ''
try {
  Invoke-KnowledgeApi -Method DELETE -Path "/$testKbId"
} catch { $delStatus='FAIL'; $delDetails="Delete: $($_.Exception.Message)" }
Add-Result 'EMBED' 'EMB-005' 'Cleanup test KB entry' $delStatus '' $null $delDetails "DELETE /api/knowledge/$testKbId" ''

# =============================================================================
# GROUP 5: Ambiguity & No-Hallucination
# =============================================================================
Write-Host "`n=== GROUP 5: Ambiguity & No-Hallucination ===" -ForegroundColor Cyan
$g5 = @(
  @{ Id='NH-001'; Name='Out-of-scope: coding'; Msg='Buatkan kode Python untuk sorting'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY','QUESTION'); MustContain=@(); MustNotContain=@('def ','import ','print(') }
  @{ Id='NH-002'; Name='Out-of-scope: cuaca'; Msg='Bagaimana cuaca besok di Jakarta?'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@('cerah','hujan','berawan') }
  @{ Id='NH-003'; Name='Out-of-scope: resep'; Msg='Resep nasi goreng yang enak dong'; Intent=@('AGENT','OUT_OF_SCOPE','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@('bawang','minyak','telur') }
  @{ Id='NH-004'; Name='No data: program tidak ada'; Msg='Kapan program beasiswa S3 dari desa dibuka?'; Intent=@('AGENT','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@('2026','januari','februari','maret') }
  @{ Id='NH-005'; Name='Ambigu: lapor'; Msg='saya mau lapor'; Intent=@('AGENT','QUESTION','CREATE_COMPLAINT','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $g5) { Run-Case $t 'NH' }

# =============================================================================
# GROUP 6: Fast-Intent vs Full-Agent Regression
# =============================================================================
Write-Host "`n=== GROUP 6: Fast-Intent Regression ===" -ForegroundColor Cyan
$g6 = @(
  @{ Id='FI-001'; Name='Greeting fast'; Msg='halo'; Intent=@('GREETING','SMALL_TALK','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@(); MaxMs=5000 }
  @{ Id='FI-002'; Name='Status ref fast'; Msg='cek status LAP-20260501-001'; Intent=@('CHECK_STATUS','AGENT'); MustContain=@(); MustNotContain=@(); MaxMs=5000 }
  @{ Id='FI-003'; Name='Service list fast'; Msg='layanan apa saja yang ada?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY'); MustContain=@(); MustNotContain=@(); MaxMs=5000 }
  @{ Id='FI-004'; Name='Typo still works'; Msg='gmn cra bkin ktp?'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='FI-005'; Name='Slang still works'; Msg='bang mau tanya soal surat pindah dong'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
  @{ Id='FI-006'; Name='Complex goes to agent'; Msg='Saya sudah ajukan KTP minggu lalu tapi belum ada kabar, apakah bisa dicek dan kalau memang lama saya mau ganti ke layanan domisili saja'; Intent=@('AGENT','CHECK_STATUS','SERVICE_INFO'); MustContain=@(); MustNotContain=@() }
  @{ Id='FI-007'; Name='Bahasa daerah'; Msg='mau urus surat keterangan tidak mampu buat anak sekolah'; Intent=@('SERVICE_INFO','KNOWLEDGE_QUERY','AGENT'); MustContain=@(); MustNotContain=@() }
)
foreach ($t in $g6) { Run-Case $t 'FI' }

# =============================================================================
# GROUP 7: Multi-turn Session Context
# =============================================================================
Write-Host "`n=== GROUP 7: Multi-turn Context ===" -ForegroundColor Cyan
$sid_multi = "${sessionPrefixForWebchat}_MULTI_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
$multiTurns = @(
  @{ Msg='saya mau bikin KTP baru'; MustContain=@('KTP') }
  @{ Msg='apa saja syaratnya?'; MustContain=@() }
  @{ Msg='bisa online tidak?'; MustContain=@() }
  @{ Msg='oke terima kasih'; MustContain=@() }
)
$turnIdx = 0
foreach ($turn in $multiTurns) {
  $turnIdx++
  $status='PASS'; $details=''; $intent=''; $ms=$null; $resp=''
  try {
    $r = Invoke-Webchat -Message $turn.Msg -SessionId $sid_multi
    $intent = [string]$r.intent; $resp = [string]$r.response; $ms = $r.metadata.processingTimeMs
    if (-not $r.success) { $status='FAIL'; $details='success=false' }
    if ($status -eq 'PASS' -and $turn.MustContain.Count -gt 0) {
      $err = Assert-Contains -Text $resp -Needles $turn.MustContain
      if ($err) { $status='FAIL'; $details=$err }
    }
  } catch { $status='ERROR'; $details=$_.Exception.Message }
  Add-Result 'MULTI' "MT-t$turnIdx" "KTP multi-turn $turnIdx" $status $intent $ms $details $turn.Msg $resp
}

# =============================================================================
# SUMMARY
# =============================================================================
$ended = Get-Date
$elapsed = New-TimeSpan -Start $started -End $ended
$pass = ($results | Where-Object Status -eq 'PASS').Count
$fail = ($results | Where-Object Status -eq 'FAIL').Count
$err  = ($results | Where-Object Status -eq 'ERROR').Count
$total = $results.Count

Write-Host "`n=== AUDIT SUMMARY ===" -ForegroundColor Cyan
Write-Host "Total: $total | PASS: $pass | FAIL: $fail | ERROR: $err | Duration: $($elapsed.ToString())"
$results | Group-Object Group | ForEach-Object {
  $gpass = ($_.Group | Where-Object Status -eq 'PASS').Count
  $gtotal = $_.Group.Count
  Write-Host ("  $($_.Name.PadRight(12)): $gpass/$gtotal PASS")
}

$outDir = Join-Path $PSScriptRoot 'qa-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir ("ai-agent-audit-sanreseng-ade_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$results | ConvertTo-Json -Depth 6 | Out-File -FilePath $outFile -Encoding utf8
Write-Host "`nSaved: $outFile" -ForegroundColor Cyan

if (($fail + $err) -gt 0) { exit 1 } else { exit 0 }
