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

Run a verified local production server with stale-port cleanup, a 6144 MB build guard, HTTP probes, and runtime metadata written to `.hermes/runtime/lambenti-local-server.json`:

```bash
npm run lambenti:serve:verified
```

Check or stop the managed local runtime:

```bash
npm run runtime:status
npm run runtime:ensure
npm run runtime:stop
```

The legacy raw local production server command still works when you explicitly want a foreground Next wrapper:

```bash
npm run start:local
```

Open:

```text
http://127.0.0.1:5173
```

If a stale server is using port `5173`, prefer `npm run lambenti:serve:verified` or `npm run runtime:stop` so runtime metadata and port ownership stay synchronized.

## Tracking automation

The `/tracking` workbench saves and links tracking numbers from Alibaba/email evidence. Carrier-status refresh is live only after a tracking provider is configured. The recommended Lambenti setup is Ship24: official docs list API/webhook tracking for global parcels including China Post and UPS, and official pricing currently shows a low-volume free tier plus a $39/mo 1,000-shipment Pro tier.

```bash
# .env
LAMBENTI_TRACKING_STATUS_PROVIDER="SHIP24"
LAMBENTI_TRACKING_STATUS_AUTH_TOKEN=<ship24_api_key_from_dashboard>
LAMBENTI_TRACKING_SHIP24_BASE_URL="https://api.ship24.com"
LAMBENTI_TRACKING_DESTINATION_COUNTRY_CODE="CA"
LAMBENTI_TRACKING_REFRESH_INTERVAL_MINUTES="240"
```

Advanced/custom provider fallback remains available when needed:

```bash
# .env
LAMBENTI_TRACKING_STATUS_PROVIDER="CUSTOM_HTTP"
LAMBENTI_TRACKING_STATUS_URL_TEMPLATE="https://provider.example/status/{trackingNumber}"
LAMBENTI_TRACKING_STATUS_AUTH_TOKEN=<custom_provider_token>
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

### Token-efficient context checks

Before inspecting a large dirty tree, get counts and top-risk files instead of dumping full status/diff output:

```bash
npm run context:snapshot
```

For scoped work, filter the snapshot to the changed area:

```bash
npm run context:snapshot -- --paths=src/app/tracking,src/modules/tracking --top=5 --statusLimit=8
```

The snapshot suppresses repetitive Git CRLF/LF warning spam, reports changed-file counts, top `numstat` files, checkpoint line counts, and current local runtime metadata. If it reports a large dirty tree, inspect only relevant files/ranges next.

Preferred full gate:

```bash
npm run lint && npm run typecheck && npm run test:serial && npm run build
```

Use serial Vitest for local DB integration reliability.

For small UI/theme/sidebar/table fixes, use the tiny UI ladder before escalating to the full gate:

```bash
npm run verify:tiny-ui
```

This runs focused source-contract tests, typecheck, lint, and the reusable Playwright UI contract smoke. The UI contract smoke checks route markers, sidebar title alignment, dark-mode movement hover color, sticky table-cell hover behavior, and browser console/page errors:

```bash
npm run smoke:ui-contracts -- --base-url=http://127.0.0.1:5173
```

Scope classifier for future UI work:

- Precise UI fix: patch only the named component/route and run the tiny UI ladder.
- "Make suggested changes": implement one to three highest-impact workflow slices first, then verify.
- Full UI redesign or shared layout/global CSS: run tiny UI checks plus `npm run smoke:browser` and a production build.
