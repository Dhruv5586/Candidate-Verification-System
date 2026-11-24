@echo off
echo Starting Candidate Verification System Services...
start "Go Auth Service (Port 8080)" cmd /k "cd /d D:\CandidateVerificationSystem\go-auth && go run ./cmd/server"
start "Node.js API (Port 3000)" cmd /k "cd /d D:\CandidateVerificationSystem\node-api && npm run dev"
echo Services launched in separate windows!
echo - Go Auth:     http://localhost:8080
echo - Node.js API: http://localhost:3000
echo - Swagger API: http://localhost:3000/api/v1/docs
pause
