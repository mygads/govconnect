Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$headers = @{
  'x-internal-api-key' = 'govconnect-internal-api-key-2025'
  'x-village-id' = 'cmkuvo1dk0000mj60h4u4bq1w'
  'x-admin-role' = 'village_admin'
}

$body = @{
  wa_user_id = '6289916487999'
  kategori = 'Infrastruktur'
  deskripsi = ('s2_unique_' + (Get-Date -Format 'HHmmssfff'))
  alamat = 'Dusun Test RT 01/02'
  village_id = 'cmkuvo1dk0000mj60h4u4bq1w'
  channel = 'WHATSAPP'
  reporter_name = 'S2 Test'
} | ConvertTo-Json -Compress

$r = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:3003/laporan/create' -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30 -SkipHttpErrorCheck
Write-Host ('POST /laporan/create (unique): {0}' -f $r.StatusCode)

$content = $r.Content | ConvertFrom-Json
$newId = $content.data.id
$newComplaintId = $content.data.complaint_id
Write-Host ('  id={0} complaint_id={1}' -f $newId, $newComplaintId)

if ($newId) {
  $uri = ('http://127.0.0.1:3003/laporan/{0}?village_id=cmkuvo1dk0000mj60h4u4bq1w' -f $newId)
  $r2 = Invoke-WebRequest -Method Get -Uri $uri -Headers $headers -TimeoutSec 10 -SkipHttpErrorCheck
  Write-Host ('GET verify: {0}' -f $r2.StatusCode)

  $cancelBody = @{ reason = 's2_test cleanup' } | ConvertTo-Json -Compress
  $cancelUri = ('http://127.0.0.1:3003/laporan/{0}/cancel?village_id=cmkuvo1dk0000mj60h4u4bq1w' -f $newId)
  $r3 = Invoke-WebRequest -Method Post -Uri $cancelUri -Headers $headers -Body $cancelBody -ContentType 'application/json' -TimeoutSec 10 -SkipHttpErrorCheck
  Write-Host ('Cancel cleanup: {0}' -f $r3.StatusCode)
}
