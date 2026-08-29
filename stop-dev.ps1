# JIDIS Local Stop Script (Surgical Port Killer)
# Run in PowerShell: .\stop-dev.ps1

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Stopping JIDIS Services on Specific Ports Only   " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 1. Stop Docker Compose containers in WSL (if running)
Write-Host "`n1. Checking & stopping Docker containers (if any)..." -ForegroundColor Yellow
wsl -e docker compose down 2>$null
Write-Host " -> [OK] Docker containers checked/stopped." -ForegroundColor Green

# 2. Surgically stop ONLY the ports used by JIDIS start-dev
$ports = @(8001, 8002, 8003, 8004, 4000, 3000, 5173)
Write-Host "`n2. Menghapus proses yang khusus jalan di port JIDIS ($($ports -join ', '))..." -ForegroundColor Yellow

foreach ($port in $ports) {
    # Stop processes in Windows Host
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            Write-Host " -> Menghentikan proses di Port $port (PID: $($conn.OwningProcess))..." -ForegroundColor Cyan
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }

    # Stop processes in WSL Linux (if running inside WSL filesystem)
    wsl -e bash -c "lsof -t -i:$port | xargs kill -9 2>/dev/null || fuser -k -n tcp $port 2>/dev/null || true" 2>$null
}

Write-Host "`n[SUCCESS] Semua port khusus JIDIS telah dibersihkan tanpa menyebgol aplikasi lain!`n" -ForegroundColor Green
