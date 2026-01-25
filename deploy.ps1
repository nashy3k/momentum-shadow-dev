# Momentum Shadow Developer: One-Click Deploy
$ErrorActionPreference = "Stop"

Write-Host "Preparing Momentum Cloud Deployment..." -ForegroundColor Cyan

# 1. Build the functions
Write-Host "Building functions..."
Set-Location functions
npm run build

# 2. Deploy to Firebase
Write-Host "Pushing to Google Cloud (us-central1)..."
firebase deploy --only functions --project momentum-shadow-dev-4321

Write-Host "Deployment Complete!" -ForegroundColor Green
Set-Location ..
