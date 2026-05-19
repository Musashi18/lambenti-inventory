$ErrorActionPreference = "Stop"

function Require-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not available on PATH. $InstallHint"
  }
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

Require-Command "node" "Install Node.js 22 LTS or newer."
Require-Command "npm" "Install npm with Node.js."
Require-Command "docker" "Install Docker Desktop and reopen your terminal."

npm install
npx prisma generate
docker compose up -d db
npx prisma migrate deploy
npx prisma db seed

Write-Host "Lambenti setup complete. Run: npm run dev"
