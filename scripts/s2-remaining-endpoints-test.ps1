Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DashboardBase = 'http://127.0.0.1:3010'
$CaseBase = 'http://127.0.0.1:3003'
$VillageId = 'cmkuvo1dk0000mj60h4u4bq1w'

$saToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='superadmin') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()
$vaToken = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT token FROM dashboard.admin_sessions WHERE admin_id=(SELECT id FROM dashboard.admin_users WHERE username='admin_sangreseng') AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1;").Trim()

$saH = @{ 'Cookie' = ('token=' + $saToken); 'Content-Type' = 'application/json' }
$vaH = @{ 'Cookie' = ('token=' + $vaToken); 'Content-Type' = 'application/json' }

$script:pass = 0; $script:fail = 0; $script:failed = @()

function Test-Api {
  param([string]$Label, [string]$Method, [string]$Url, [hashtable]$Headers, $Body = $null, [int]$Expected = 200, [int]$Timeout = 15)
  $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = $Timeout; SkipHttpErrorCheck = $true }
  if ($Body) { $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 -Compress } }
  $r = Invoke-WebRequest @params
  $ok = $r.StatusCode -eq $Expected
  if ($ok) { $script:pass++; Write-Host ('[PASS] {0}: {1}' -f $Label, $r.StatusCode) }
  else {
    $script:fail++; $script:failed += ('{0} ({1} expected {2})' -f $Label, $r.StatusCode, $Expected)
    Write-Host ('[FAIL] {0}: {1} (expected {2}) | {3}' -f $Label, $r.StatusCode, $Expected, $r.Content.Substring(0,[Math]::Min(120,$r.Content.Length)))
  }
  return $r
}

Write-Host '=== 1. VA: Knowledge gaps + conflicts batch PATCH ==='

# Get gap IDs
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/knowledge/gaps" -Headers $vaH -TimeoutSec 10 -SkipHttpErrorCheck
$gaps = ($r.Content | ConvertFrom-Json).data
if ($gaps -and $gaps.Count -gt 0) {
  $gapIds = @($gaps | Select-Object -First 2 | ForEach-Object { $_.id })
  Test-Api -Label 'VA PATCH /api/knowledge-gaps/batch (ignore)' -Method Patch -Url "$DashboardBase/api/knowledge-gaps/batch" -Headers $vaH -Body @{ status = 'ignored'; ids = $gapIds }
  Test-Api -Label 'VA PATCH /api/knowledge-gaps/batch (revert open)' -Method Patch -Url "$DashboardBase/api/knowledge-gaps/batch" -Headers $vaH -Body @{ status = 'open'; ids = $gapIds }
} else { Write-Host '  no gaps — skip' }

# Knowledge conflicts
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/knowledge-conflicts" -Headers $vaH -TimeoutSec 10 -SkipHttpErrorCheck
if ($r.StatusCode -eq 200) {
  $conflicts = ($r.Content | ConvertFrom-Json).data
  if ($conflicts -and $conflicts.Count -gt 0) {
    $conflictIds = @($conflicts | Select-Object -First 2 | ForEach-Object { $_.id })
    Test-Api -Label 'VA PATCH /api/knowledge-conflicts/batch (ignore)' -Method Patch -Url "$DashboardBase/api/knowledge-conflicts/batch" -Headers $vaH -Body @{ status = 'ignored'; ids = $conflictIds }
    Test-Api -Label 'VA PATCH /api/knowledge-conflicts/batch (revert)' -Method Patch -Url "$DashboardBase/api/knowledge-conflicts/batch" -Headers $vaH -Body @{ status = 'open'; ids = $conflictIds }
  } else { Write-Host '  no conflicts — skip' }
} else { Write-Host "  knowledge-conflicts GET: $($r.StatusCode)" }

Write-Host ''
Write-Host '=== 2. VA: Complaint update note (POST /api/laporan/[id]/updates) ==='

$lapId = (docker exec infra-postgres psql -U postgres -d govconnect -t -A -c "SELECT id FROM cases.complaints WHERE village_id='$VillageId' AND status='OPEN' ORDER BY created_at DESC LIMIT 1;").Trim()
if ($lapId) {
  Test-Api -Label 'VA POST /api/laporan/[id]/updates' -Method Post -Url "$DashboardBase/api/laporan/$lapId/updates" -Headers $vaH -Body @{ note_text = ('s2_test update note ' + (Get-Date -Format 'HH:mm:ss')) }
}

Write-Host ''
Write-Host '=== 3. VA: Layanan (services) CRUD via dashboard ==='

# Get existing category
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/layanan/categories" -Headers $vaH -TimeoutSec 10 -SkipHttpErrorCheck
$cats = ($r.Content | ConvertFrom-Json).data
$catId = $cats[0].id
Write-Host ('  using category id: {0}' -f $catId)

# Create test service
$svcSlug = 's2-test-svc-' + (Get-Date -Format 'HHmmss')
$createSvc = @{
  name = ('S2 Test Service ' + (Get-Date -Format 'HHmmss'))
  description = 's2 regression test service'
  category_id = $catId
  slug = $svcSlug
  mode = 'both'
  is_active = $true
}
$r = Test-Api -Label 'VA POST /api/layanan (create service)' -Method Post -Url "$DashboardBase/api/layanan" -Headers $vaH -Body $createSvc -Expected 201
$svcData = $r.Content | ConvertFrom-Json
$newSvcId = $null
if ($svcData.PSObject.Properties.Name -contains 'data') { $newSvcId = $svcData.data.id }
Write-Host ('  created service id: {0}' -f $newSvcId)

if ($newSvcId) {
  # Add requirement
  $reqBody = @{ label = 'KTP Test'; field_type = 'file'; is_required = $true; order_index = 0 }
  $r = Test-Api -Label 'VA POST /api/layanan/[id]/requirements' -Method Post -Url "$DashboardBase/api/layanan/$newSvcId/requirements" -Headers $vaH -Body $reqBody -Expected 201
  $reqData = $r.Content | ConvertFrom-Json
  $newReqId = $null
  if ($reqData.PSObject.Properties.Name -contains 'data') { $newReqId = $reqData.data.id }
  Write-Host ('  created requirement id: {0}' -f $newReqId)

  if ($newReqId) {
    # Update requirement
    Test-Api -Label 'VA PUT /api/layanan/requirements/[id]' -Method Put -Url "$DashboardBase/api/layanan/requirements/$newReqId" -Headers $vaH -Body @{ label = 'KTP Updated'; is_required = $true }
    # Delete requirement
    Test-Api -Label 'VA DELETE /api/layanan/requirements/[id]' -Method Delete -Url "$DashboardBase/api/layanan/requirements/$newReqId" -Headers $vaH
  }

  # Update service
  Test-Api -Label 'VA PUT /api/layanan/[id] (update service)' -Method Put -Url "$DashboardBase/api/layanan/$newSvcId" -Headers $vaH -Body @{ name = 'S2 Test Service UPDATED'; is_active = $false }

  # Delete service (cleanup)
  Test-Api -Label 'VA DELETE /api/layanan/[id] (cleanup)' -Method Delete -Url "$DashboardBase/api/layanan/$newSvcId" -Headers $vaH
}

Write-Host ''
Write-Host '=== 4. VA: Layanan categories CRUD ==='

$newCatName = 's2_test_layanan_cat_' + (Get-Date -Format 'HHmmss')
$r = Test-Api -Label 'VA POST /api/layanan/categories' -Method Post -Url "$DashboardBase/api/layanan/categories" -Headers $vaH -Body @{ name = $newCatName; description = 's2 test' } -Expected 201
$catData = $r.Content | ConvertFrom-Json
$newCatId = $null
if ($catData.PSObject.Properties.Name -contains 'data') { $newCatId = $catData.data.id }

if ($newCatId) {
  Test-Api -Label 'VA PATCH /api/layanan/categories/[id]' -Method Patch -Url "$DashboardBase/api/layanan/categories/$newCatId" -Headers $vaH -Body @{ name = 's2_test_cat_updated' }
  Test-Api -Label 'VA DELETE /api/layanan/categories/[id]' -Method Delete -Url "$DashboardBase/api/layanan/categories/$newCatId" -Headers $vaH
}

Write-Host ''
Write-Host '=== 5. SA: AI models + providers CRUD (safe test) ==='

# List existing models to get one for update test
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/superadmin/ai-models" -Headers $saH -TimeoutSec 10 -SkipHttpErrorCheck
$models = ($r.Content | ConvertFrom-Json).data
$firstModelId = $models[0].id
Write-Host ('  first model id: {0}' -f $firstModelId)

# PUT update model (toggle notes field only — safe)
$origNotes = $models[0].notes
$testNotes = 's2_test_' + (Get-Date -Format 'HHmmss')
Test-Api -Label 'SA PUT /api/superadmin/ai-models/[id] (update notes)' -Method Put -Url "$DashboardBase/api/superadmin/ai-models/$firstModelId" -Headers $saH -Body @{ notes = $testNotes }
# Revert
Test-Api -Label 'SA PUT /api/superadmin/ai-models/[id] (revert notes)' -Method Put -Url "$DashboardBase/api/superadmin/ai-models/$firstModelId" -Headers $saH -Body @{ notes = $origNotes }

# Lane assignments list
$r = Invoke-WebRequest -Method Get -Uri "$DashboardBase/api/superadmin/ai-lane-assignments" -Headers $saH -TimeoutSec 10 -SkipHttpErrorCheck
$assignments = ($r.Content | ConvertFrom-Json).data
Write-Host ('  lane assignments count: {0}' -f $assignments.Count)
$firstAssignment = $assignments[0]
Write-Host ('  first assignment: lane={0} model_id={1}' -f $firstAssignment.lane_type, $firstAssignment.model_id)

# POST lane assignment (upsert same value — safe)
$upsertBody = @{
  lane_type = $firstAssignment.lane_type
  model_id = $firstAssignment.model_id
  fallback_model_id = $firstAssignment.fallback_model_id
}
Test-Api -Label 'SA POST /api/superadmin/ai-lane-assignments (upsert same)' -Method Post -Url "$DashboardBase/api/superadmin/ai-lane-assignments" -Headers $saH -Body $upsertBody

Write-Host ''
Write-Host ('===== Summary: PASS={0} FAIL={1} =====' -f $script:pass, $script:fail)
if ($script:failed.Count -gt 0) {
  Write-Host 'Failures:'
  foreach ($f in $script:failed) { Write-Host ('  - ' + $f) }
}
