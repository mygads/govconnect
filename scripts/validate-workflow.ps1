# ===================================================================================
# GOVCONNECT - WORKFLOW VALIDATION SCRIPT
# ===================================================================================
# 
# Script untuk validasi GitHub Actions workflow sebelum commit
# Usage: .\scripts\validate-workflow.ps1
#
# ===================================================================================

Write-Host "🔍 GitHub Actions Workflow Validation" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

$workflowFile = ".github\workflows\ci-cd.yml"

if (-not (Test-Path $workflowFile)) {
    Write-Host "❌ Workflow file not found: $workflowFile" -ForegroundColor Red
    exit 1
}

Write-Host "📁 Validating: $workflowFile" -ForegroundColor Blue

$content = Get-Content $workflowFile -Raw
$lines = $content -split "`n"
$issues = @()
$warnings = @()

Write-Host ""
Write-Host "🔍 Running validation checks..." -ForegroundColor Yellow

# Check 1: Basic YAML structure
Write-Host "1. Checking basic YAML structure..."
if ($content -match "`t") {
    $issues += "Contains tab characters (should use spaces for indentation)"
}

# Check 2: Heredoc balance
Write-Host "2. Checking heredoc balance..."
$lines = $content -split "`n"
$heredocStarts = 0
$heredocEnds = 0

foreach ($line in $lines) {
    if ($line -match "<<.*'.*_SCRIPT'") {
        $heredocStarts++
    }
    if ($line -match "^\s*[A-Z_]+_SCRIPT\s*$" -and $line -notmatch "<<") {
        $heredocEnds++
    }
}

if ($heredocStarts -ne $heredocEnds) {
    $issues += "Unbalanced heredoc markers (starts: $heredocStarts, ends: $heredocEnds)"
}

# Check 3: Required sections
Write-Host "3. Checking required sections..."
$requiredSections = @("name:", "on:", "jobs:")
foreach ($section in $requiredSections) {
    if ($content -notmatch $section) {
        $issues += "Missing required section: $section"
    }
}

# Check 4: Secret references
Write-Host "4. Checking secret references..."
$secretRefs = $content | Select-String '\$\{\{\s*secrets\.' -AllMatches
$requiredSecrets = @("VPS_HOST", "VPS_USER", "VPS_SSH_KEY", "GHCR_TOKEN")
foreach ($secret in $requiredSecrets) {
    if ($content -notmatch "secrets\.$secret") {
        $warnings += "Secret not referenced: $secret"
    }
}

# Check 5: Action versions
Write-Host "5. Checking action versions..."
$actionRefs = $content | Select-String 'uses:\s*([^@]+)@(.+)' -AllMatches
foreach ($match in $actionRefs) {
    $action = $match.Matches[0].Groups[1].Value
    $version = $match.Matches[0].Groups[2].Value
    
    if ($version -match '^v\d+$') {
        $warnings += "Action $action uses major version only ($version) - consider pinning to specific version"
    }
}

# Check 6: Dangerous commands
Write-Host "6. Checking for dangerous commands..."
$dangerousPatterns = @(
    "rm -rf /",
    "sudo rm -rf",
    "chmod 777",
    "password.*=.*[^example]"
)

foreach ($pattern in $dangerousPatterns) {
    if ($content -match $pattern) {
        $issues += "Potentially dangerous command pattern found: $pattern"
    }
}

# Check 7: Environment variables
Write-Host "7. Checking environment variables..."
if ($content -notmatch 'env:') {
    $warnings += "No environment variables defined"
}

# Check 8: Error handling
Write-Host "8. Checking error handling..."
$sshCommands = $content | Select-String 'ssh.*<<' -AllMatches
if ($sshCommands.Count -gt 0) {
    if ($content -notmatch 'set -e') {
        $warnings += "SSH commands found but no 'set -e' for error handling"
    }
}

# Check 9: File size
Write-Host "9. Checking file size..."
$fileSize = (Get-Item $workflowFile).Length
if ($fileSize -gt 50000) {
    $warnings += "Large workflow file ($fileSize bytes) - consider splitting into multiple workflows"
}

# Check 10: Syntax validation
Write-Host "10. Checking YAML syntax..."
try {
    # Basic YAML structure validation
    $yamlLines = $lines | Where-Object { $_ -match '^\s*[a-zA-Z_-]+:' }
    if ($yamlLines.Count -lt 5) {
        $warnings += "Very few YAML key-value pairs found - file might be malformed"
    }
} catch {
    $issues += "YAML syntax validation failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "📊 Validation Results" -ForegroundColor Yellow
Write-Host "===================" -ForegroundColor Yellow

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "✅ All checks passed! Workflow is ready for commit." -ForegroundColor Green
    exit 0
}

if ($issues.Count -gt 0) {
    Write-Host ""
    Write-Host "❌ CRITICAL ISSUES (must fix before commit):" -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "⚠️ WARNINGS (recommended to fix):" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "📋 Summary:" -ForegroundColor Cyan
Write-Host "- Critical Issues: $($issues.Count)" -ForegroundColor $(if ($issues.Count -eq 0) { "Green" } else { "Red" })
Write-Host "- Warnings: $($warnings.Count)" -ForegroundColor $(if ($warnings.Count -eq 0) { "Green" } else { "Yellow" })

if ($issues.Count -gt 0) {
    Write-Host ""
    Write-Host "🚫 Workflow validation FAILED. Please fix critical issues before committing." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "✅ Workflow validation PASSED. Safe to commit!" -ForegroundColor Green
    if ($warnings.Count -gt 0) {
        Write-Host "💡 Consider addressing warnings for better workflow quality." -ForegroundColor Blue
    }
    exit 0
}