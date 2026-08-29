# JIDIS Local Start Script (Smart Local/Docker Postgres Check + Auto-Clean Ports)
# Run this script in PowerShell: .\start-dev.ps1

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "Starting JIDIS System (Smart Postgres Check + Auto-Clean)" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

# Root directory
$root = $PSScriptRoot

# 0. Auto-Clean Existing Ports before starting (Mencegah EADDRINUSE)
Write-Host "`n0. Membersihkan port lama JIDIS (8001-8004, 4000, 3000) jika masih nyala..." -ForegroundColor Yellow
& "$root\stop-dev.ps1" | Out-Null
Write-Host " -> [OK] Semua port JIDIS bebas & bersih!" -ForegroundColor Green
Start-Sleep -Seconds 1

# 1. Smart Check PostgreSQL Connection (Local vs Docker WSL)
Write-Host "`n1. Checking PostgreSQL Database availability on Port 5432..." -ForegroundColor Yellow
$pgTest = Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue

if ($pgTest) {
    Write-Host " -> [OK] PostgreSQL Lokal terdeteksi aktif di port 5432! Menggunakan PostgreSQL lokal." -ForegroundColor Green
} else {
    Write-Host " -> [WARN] PostgreSQL lokal tidak terdeteksi di port 5432." -ForegroundColor Yellow
    Write-Host " -> Mengaktifkan PostgreSQL otomatis menggunakan Docker di WSL..." -ForegroundColor Cyan
    Set-Location "$root"
    wsl -e docker compose up -d postgres
    Write-Host " -> Menunggu 5 detik agar container Postgres siap..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
}

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
    throw "Missing $envFile. Copy .env.example and configure DATABASE_URL and ENCRYPTION_KEY first."
}
$databaseLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$encryptionLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^ENCRYPTION_KEY=' } | Select-Object -First 1
if (-not $databaseLine -or -not $encryptionLine) {
    throw ".env must define DATABASE_URL and ENCRYPTION_KEY."
}
$env:DATABASE_URL = ($databaseLine -replace '^DATABASE_URL=', '').Trim().Trim('"')
$env:ENCRYPTION_KEY = ($encryptionLine -replace '^ENCRYPTION_KEY=', '').Trim().Trim('"')
Write-Host "`n2. Setting up Storage Service & Database Schema..." -ForegroundColor Yellow
Set-Location "$root\backend\storage-service"
if (-not (Test-Path "node_modules")) { npm install --quiet }
npx prisma db push --skip-generate
npx prisma generate
Set-Location "$root"

Write-Host "`n3. Launching Microservices, BFF, and Frontend..." -ForegroundColor Yellow

# 1. Start Storage Service in new window
Start-Process powershell -WorkingDirectory "$root\backend\storage-service" -ArgumentList "-NoExit", "-Command", "`$env:PORT='8004'; Write-Host '[Storage Service :8004]' -ForegroundColor Green; npm run dev"

# 2. Start Jira Service in new window
Start-Process powershell -WorkingDirectory "$root\backend\jira-service" -ArgumentList "-NoExit", "-Command", "`$env:PORT='8001'; `$env:STORAGE_SERVICE_URL='http://localhost:8004'; Write-Host '[Jira Service :8001]' -ForegroundColor Green; npm run dev"

# 3. Start GitHub Service in new window
Start-Process powershell -WorkingDirectory "$root\backend\github-service" -ArgumentList "-NoExit", "-Command", "`$env:PORT='8002'; `$env:STORAGE_SERVICE_URL='http://localhost:8004'; Write-Host '[GitHub Service :8002]' -ForegroundColor Green; npm run dev"

# 4. Start Discord Service in new window
Start-Process powershell -WorkingDirectory "$root\backend\discord-service" -ArgumentList "-NoExit", "-Command", "`$env:PORT='8003'; `$env:STORAGE_SERVICE_URL='http://localhost:8004'; Write-Host '[Discord Service :8003]' -ForegroundColor Green; npm run dev"

# 5. Start BFF GraphQL in new window
Start-Process powershell -WorkingDirectory "$root\backend\bff-graphql" -ArgumentList "-NoExit", "-Command", "`$env:PORT='4000'; `$env:STORAGE_SERVICE_URL='http://localhost:8004'; `$env:JIRA_SERVICE_URL='http://localhost:8001'; `$env:GITHUB_SERVICE_URL='http://localhost:8002'; `$env:DISCORD_SERVICE_URL='http://localhost:8003'; Write-Host '[BFF GraphQL :4000]' -ForegroundColor Green; npm run dev"

# 6. Start Frontend Web App in new window
Start-Process powershell -WorkingDirectory "$root\frontend" -ArgumentList "-NoExit", "-Command", "`$env:VITE_GRAPHQL_URL='http://localhost:4000/graphql'; Write-Host '[Frontend UI :3000]' -ForegroundColor Cyan; npm run dev"

Write-Host "`nAll 6 services launched in separate windows!" -ForegroundColor Green
Write-Host "Open Web Dashboard at: http://localhost:3000" -ForegroundColor Yellow
Write-Host "GraphQL Playground at: http://localhost:4000/graphql`n" -ForegroundColor Yellow
