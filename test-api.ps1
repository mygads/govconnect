# Test script for GovConnect APIs
$token = "eyJhbGciOiJIUzI1NiJ9.eyJhZG1pbklkIjoiY21rcnpuYjJwMDAwYW1yMDF1b2JxdzF6biIsInVzZXJuYW1lIjoibXlnYWRzIiwibmFtZSI6Ik11aGFtbWFkIFlvZ2EgQWRpIFNhcHV0cmEiLCJyb2xlIjoidmlsbGFnZV9hZG1pbiIsImlhdCI6MTc2OTIzOTcyMywiZXhwIjoxNzY5MzI2MTIzfQ.biI6jHo7qnzlQy5ts7WgGajtAhnXOTj9KiOxDV20KjE"
$baseUrl = "http://localhost:3010"
$villageId = "cmkrznayo0000mr01d8oxqxdh"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

Write-Host "`n====== TEST 1: Create WhatsApp Session ======" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/whatsapp/session?village_id=$villageId" -Method POST -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response: $($reader.ReadToEnd())"
    }
}

Write-Host "`n====== TEST 2: Knowledge Embed All ======" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/knowledge/embed-all" -Method POST -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response: $($reader.ReadToEnd())"
    }
}

Write-Host "`n====== TEST 3: Test Knowledge Search ======" -ForegroundColor Cyan
$searchBody = @{
    query = "layanan yang ada apa saja"
    include_knowledge = $true
    include_documents = $true
    top_k = 5
    min_score = 0.6
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/testing-knowledge" -Method POST -Headers $headers -Body $searchBody -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response: $($reader.ReadToEnd())"
    }
}

Write-Host "`n====== TEST 4: Check WhatsApp Status ======" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/whatsapp/status?village_id=$villageId" -Method GET -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response: $($reader.ReadToEnd())"
    }
}
