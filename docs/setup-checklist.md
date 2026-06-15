# Setup Checklist

This project is ready to run after machine-level prerequisites are installed.

## Required Tools

- Node.js 22 or newer
- npm
- Docker Desktop
- Git

## One-Time Setup

See `docs/local-runbook.md` for the verified Windows local run path, including the current PostgreSQL host-port default.

```powershell
npm run setup
```

The setup script:

1. Creates `.env` from `.env.example` if needed.
2. Installs dependencies.
3. Generates Prisma Client.
4. Starts PostgreSQL through Docker Compose.
5. Runs Prisma migrations.
6. Seeds initial Lambenti data.

## Manual Equivalent

```powershell
Copy-Item .env.example .env -Force
npm install
npx prisma generate
docker compose up -d db
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

By default Docker Compose publishes PostgreSQL on host port `55432` and `.env.example`
uses `localhost:55432`. If you change `LAMBENTI_DB_HOST_PORT`, update
`DATABASE_URL` to the same host port before running migrations/tests.

If port `3000` is blocked on Windows:

```powershell
npm run dev:local
```

Then open `http://127.0.0.1:5173`.

## Git

```powershell
git init
git add .
git commit -m "Initialize Lambenti inventory system"
```
