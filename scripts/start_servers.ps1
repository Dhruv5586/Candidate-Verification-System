# Start Go Auth Service (Port 8080) and Node.js API (Port 3000) in separate PowerShell windows
Write-Host "Starting Candidate Verification System Services..." -ForegroundColor Cyan

# 1. Start Go Auth Service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd D:\CandidateVerificationSystem\go-auth; `$env:PATH = 'C:\Users\dhruv\AppData\Local\Programs\go\bin;' + `$env:PATH; go run ./cmd/server"

# 2. Start Node.js Express API
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd D:\CandidateVerificationSystem\node-api; npm run dev"

Write-Host "Services are launching in separate terminal windows:" -ForegroundColor Green
Write-Host "  - Go Auth Service:     http://localhost:8080" -ForegroundColor Green
Write-Host "  - Node.js Express API: http://localhost:3000" -ForegroundColor Green
Write-Host "  - Swagger Docs:        http://localhost:3000/api/v1/docs" -ForegroundColor Green
