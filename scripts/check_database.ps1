# Candidate Verification System - PostgreSQL Database Inspector
param(
    [string]$Query = ""
)

$env:PGPASSWORD = "Dhruv@2005"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$dbName = "candidate_verification"
$user = "postgres"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   CANDIDATE VERIFICATION SYSTEM - POSTGRESQL INSPECTOR   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $psql)) {
    Write-Host "[ERROR] psql.exe not found at $psql" -ForegroundColor Red
    exit 1
}

if ($Query -ne "") {
    Write-Host "Executing Custom Query:" -ForegroundColor Yellow
    Write-Host $Query -ForegroundColor Gray
    Write-Host ""
    & $psql -U $user -d $dbName -c $Query
    exit 0
}

# 1. Connection Check
Write-Host "[1/3] Database Connection Status" -ForegroundColor Yellow
$versionOutput = (& $psql -U $user -d $dbName -t -c "SELECT version();" 2>&1)
if ($LASTEXITCODE -eq 0 -and $versionOutput) {
    Write-Host "  [OK] Connected to '$dbName' on localhost:5432" -ForegroundColor Green
    $trimmedVersion = $versionOutput[0].Trim()
    if ($trimmedVersion.Length -gt 40) {
        $trimmedVersion = $trimmedVersion.Substring(0, 40) + "..."
    }
    Write-Host "  Database Version: $trimmedVersion" -ForegroundColor Gray
} else {
    Write-Host "  [FAIL] Unable to connect to PostgreSQL. Make sure the service is running." -ForegroundColor Red
    exit 1
}

# 2. Table Summary & Live Row Counts
Write-Host ""
Write-Host "[2/3] Tables & Live Row Counts" -ForegroundColor Yellow
$sqlTables = "SELECT relname AS table_name, n_live_tup AS row_count FROM pg_stat_user_tables ORDER BY relname;"
& $psql -U $user -d $dbName -c $sqlTables

# 3. Active Users and Assigned Roles
Write-Host ""
Write-Host "[3/4] Registered Users & Roles" -ForegroundColor Yellow
$sqlUsers = "SELECT u.id, u.email, u.name, u.is_active, COALESCE(string_agg(r.name, ', '), 'None') AS roles FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id LEFT JOIN roles r ON ur.role_id = r.id GROUP BY u.id, u.email, u.name, u.is_active;"
& $psql -U $user -d $dbName -c $sqlUsers

# 4. Candidate Dataset Sample
Write-Host ""
Write-Host "[4/4] Seeded Candidate Dataset Preview (First 15 Candidates)" -ForegroundColor Yellow
$sqlCandidates = "SELECT substring(c.id::text, 1, 8) || '...' AS id, c.full_name, c.email, c.current_job_title, c.location, c.status, d.file_name AS resume FROM candidates c LEFT JOIN documents d ON d.candidate_id = c.id ORDER BY c.created_at ASC LIMIT 15;"
& $psql -U $user -d $dbName -c $sqlCandidates

Write-Host ""
Write-Host "Quick Tips:" -ForegroundColor Cyan
Write-Host "  - To view candidates        : .\scripts\check_database.ps1 -Query 'SELECT full_name, email, current_job_title, location FROM candidates LIMIT 25;'" -ForegroundColor Gray
Write-Host "  - To search for a candidate : .\scripts\check_database.ps1 -Query ""SELECT full_name, email, current_job_title FROM candidates WHERE full_name ILIKE '%john%';""" -ForegroundColor Gray
Write-Host "  - To view resume extractions: .\scripts\check_database.ps1 -Query 'SELECT c.full_name, re.extracted_data FROM candidates c JOIN documents d ON d.candidate_id = c.id JOIN resume_extractions re ON re.document_id = d.id LIMIT 3;'" -ForegroundColor Gray
Write-Host "  - To open psql interactive CLI: & '$psql' -U postgres -d candidate_verification" -ForegroundColor Gray
Write-Host ""
