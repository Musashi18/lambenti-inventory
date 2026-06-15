# Lambenti Inventory and Sourcing System

Production-oriented inventory and sourcing management for Lambenti, an electronics hardware startup building magnetic light interaction systems.

## Stack

- Next.js App Router
- TypeScript
- Prisma ORM
- PostgreSQL
- Tailwind CSS
- Docker Compose

## What This System Covers

- Electronic components, raw materials, finished goods, and storage locations
- Immutable stock movement ledger with calculated current stock
- Suppliers, offers, pricing tiers, and supplier comparison
- BOMs and BOM explosion views
- Purchase requests, approval workflow, and purchase orders
- Agent-readable APIs with strict limits on what agents may do
- Audit logging for human and agent actions

## Architecture

```text
src/
  app/                  UI routes, server actions, and route handlers
  components/           Reusable dashboard and table components
  lib/                  Shared infrastructure such as Prisma and audit helpers
  modules/              Business logic grouped by domain
  types/                Shared DTOs and strongly typed view models
prisma/
  schema.prisma         Database schema
  migrations/           Versioned database migrations
  seed.ts               Initial seed data
```

The database is the system of record. Inventory state is never stored as mutable current quantity only; stock on hand is derived from immutable movement history.

## Local Setup

1. Copy `.env.example` to `.env`. By default local PostgreSQL is published on
   host port `55432`; keep `LAMBENTI_DB_HOST_PORT` and `DATABASE_URL` aligned if
   you change it.
2. Start PostgreSQL:

```bash
docker compose up -d db
```

3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client and apply migrations:

```bash
npx prisma generate
npx prisma migrate deploy
```

5. Seed the database:

```bash
npx prisma db seed
```

6. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

If Windows blocks binding to `0.0.0.0:3000`, start on localhost port `5173` instead:

```powershell
npm run dev:local
```

Open `http://127.0.0.1:5173`.

You can also run the setup script:

```powershell
npm run setup
```

The setup script installs dependencies, generates Prisma Client, starts the database, runs migrations, and seeds initial data.

## Docker App Stack

Run the app and database together:

```bash
docker compose up --build
```

The app container runs `prisma migrate deploy` before starting Next.js.

## Main Routes

- `/` dashboard
- `/inventory/items`
- `/inventory/movements`
- `/suppliers`
- `/purchasing/recommendations`
- `/purchasing/requests`
- `/boms`
- `/incoming`

## Agent API Routes

- `GET /api/agent/stock`
- `GET /api/agent/boms`
- `GET /api/agent/shortages`
- `GET /api/agent/supplier-offers`
- `POST /api/agent/purchase-requests`

Agents may read planning data and create draft purchase requests. They may not modify inventory, place purchase orders, or delete records.

## Git Initialization Guidance

```bash
git init
git add .
git commit -m "Initialize Lambenti inventory system"
```

If `git` is not recognized, install Git first and reopen the terminal so it is available on `PATH`.
