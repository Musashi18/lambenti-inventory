# Local Runbook

This is the verified local Windows run path for the Lambenti inventory app.

## Database

Docker Compose publishes PostgreSQL on host port `55432` by default because this Windows host refused binding host port `5432` during verification.

- Compose port setting: `${LAMBENTI_DB_HOST_PORT:-55432}:5432`
- `.env.example` default: `DATABASE_URL` uses `localhost:55432`
- Current container: `lambenti-postgres`

Start or recreate the database without deleting the named volume:

```bash
docker compose create db
docker compose start db
```

Check health and port mapping:

```bash
docker compose ps
docker port lambenti-postgres 5432/tcp
```

Expected mapping:

```text
0.0.0.0:55432
[::]:55432
```

If you intentionally change `LAMBENTI_DB_HOST_PORT`, update `DATABASE_URL` to the same host port before running Prisma commands or tests.

## App

Install/generate/migrate/seed:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

Run the local production smoke server:

```bash
npm run start:local
```

Open:

```text
http://127.0.0.1:5173
```

If a stale server is using port `5173`, find and kill the port owner before restarting.

## Tracking automation

The `/tracking` workbench saves and links tracking numbers from Alibaba/email evidence. Carrier-status refresh is live only after a tracking provider is configured. The recommended Lambenti setup is Ship24: official docs list API/webhook tracking for global parcels including China Post and UPS, and official pricing currently shows a low-volume free tier plus a $39/mo 1,000-shipment Pro tier.

```bash
# .env
LAMBENTI_TRACKING_STATUS_PROVIDER="SHIP24"
LAMBENTI_TRACKING_STATUS_AUTH_TOKEN="ship24_api_key_from_dashboard"
LAMBENTI_TRACKING_SHIP24_BASE_URL="https://api.ship24.com"
LAMBENTI_TRACKING_DESTINATION_COUNTRY_CODE="CA"
LAMBENTI_TRACKING_REFRESH_INTERVAL_MINUTES="240"
```

Advanced/custom provider fallback remains available when needed:

```bash
# .env
LAMBENTI_TRACKING_STATUS_PROVIDER="CUSTOM_HTTP"
LAMBENTI_TRACKING_STATUS_URL_TEMPLATE="https://provider.example/status/{trackingNumber}"
LAMBENTI_TRACKING_STATUS_AUTH_TOKEN="custom_provider_token"
LAMBENTI_TRACKING_STATUS_AUTH_HEADER="authorization"
```

Run one scheduled refresh tick against the local app:

```bash
npm run agent:tracking-refresh -- --verbose
```

For hands-off refresh, point Windows Task Scheduler, Hermes cron, or another scheduler at:

```bash
npm run agent:tracking-refresh
```

Quiet scheduled runs stay silent when no provider is configured or when nothing changed. Any refresh writes shipment metadata/events only; it never receives stock or confirms delivery.

## Quality gates

Preferred full gate:

```bash
npm run lint && npm run typecheck && npm run test:serial && npm run build
```

Use serial Vitest for local DB integration reliability.
