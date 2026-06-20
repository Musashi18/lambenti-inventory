# Tracking Provider Research and Setup Decision

Date: 2026-06-14

## Decision

Use **Ship24** as the default Lambenti tracking-status provider, with the existing custom-HTTP template kept as an escape hatch.

Why Ship24 fits Lambenti now:

- Lambenti's current shipments are low-volume inbound supplier parcels from Alibaba/China plus occasional UPS-style emails.
- Ship24 official docs describe global package tracking by API/webhooks and explicitly list couriers including China Post and UPS.
- Ship24 official OpenAPI docs expose a JSON REST API with bearer-token auth, `POST /public/v1/trackers/track`, tracker IDs, `clientTrackerId`, webhook support, courier auto-detection, and standard shipment/event status fields.
- Ship24 official pricing page showed a usable low-volume path during research: Free plan with 10 shipments/month plus first-month 100-shipment bonus, and Pro at $39/mo for 1,000 shipments/month with AI courier auto-detection, webhook notifications, and detailed API docs.
- The API model matches the app's existing `TrackingNumber`/`TrackingEvent` design: one tracker per shipment, status/events stored as metadata, no receiving side effects.

## Provider comparison snapshot

| Provider | Evidence from research | Fit for Lambenti |
|---|---|---|
| Ship24 | Official docs: global API/webhook tracking; China Post and UPS listed; OpenAPI 3.1; bearer auth; `POST /public/v1/trackers/track`; recommends unique `clientTrackerId`. Official pricing page showed Free 10 shipments/month + first-month 100 bonus, Pro $39/mo/1,000 shipments. | Best default: low-volume friendly, China/UPS coverage, auto-detection, clean API, cheap enough if Lambenti grows. |
| TrackingMore | Official pricing page: 1,617 couriers, auto-detect carrier, Free 50 credits/month; Pro list includes Tracking API and Webhook at $59/mo billed annually in the observed page. | Strong but higher minimum API cost for the app's current use. Keep as future alternative. |
| EasyPost | Official pricing page: Tracking API $0.01-$0.03/shipment; docs expose Tracker object and webhooks. | Good for North American shipping labels/basic carrier tracking, but less aligned with Alibaba/China-origin evidence and courier auto-detection needs. |
| 17TRACK | Official page content fetched: 3300+ carriers/190+ airlines, API product, free widget. | Coverage attractive, but API/pricing/setup were less directly inspectable in this environment; defer unless Ship24 misses carriers. |
| AfterShip | Official site was blocked by Cloudflare in this environment, so current pricing/API details were not verified here. | Known category leader, but not selected without current verified pricing/setup evidence. |

## Setup

1. Create/sign in to Ship24 and open the developer/dashboard area.
2. Subscribe to the Free plan for initial Lambenti use.
3. Copy the API key from the Ship24 dashboard.
4. Add to `.env`:

```bash
LAMBENTI_TRACKING_STATUS_PROVIDER="SHIP24"
LAMBENTI_TRACKING_STATUS_AUTH_TOKEN=<ship24-api-key>
LAMBENTI_TRACKING_SHIP24_BASE_URL="https://api.ship24.com"
LAMBENTI_TRACKING_DESTINATION_COUNTRY_CODE="CA"
LAMBENTI_TRACKING_REFRESH_INTERVAL_MINUTES="240"
```

Optional non-loopback scheduler/API secret:

```bash
LAMBENTI_TRACKING_AGENT_SECRET=<random-local-secret>
```

5. Restart the local app so env changes are loaded.
6. Run one refresh tick:

```bash
npm run agent:tracking-refresh -- --verbose
```

7. Open `/tracking` and verify that the service card shows `SHIP24 configured` and rows move from `CONFIG_REQUIRED` to provider statuses/events after refresh.

## Implementation notes

- The app sends Ship24 `clientTrackerId` as the local `TrackingNumber.id`; this aligns with Ship24's uniqueness guidance and prevents tracking-number reuse from confusing separate shipments.
- The app sends `shipmentReference` as external Alibaba order ID when available, falling back to PO/import/local tracking ID.
- The app defaults destination country to `CA` because Lambenti currently receives supplier shipments into Canada. Override with `LAMBENTI_TRACKING_DESTINATION_COUNTRY_CODE` if needed.
- Courier code is intentionally not hardcoded; Ship24 auto-detection is preferred because Alibaba logistics can hand off across carriers. The app sends `courierName` only when it already inferred a carrier.
- Delivery remains metadata only. Even if Ship24 says delivered, receiving still requires explicit `/incoming` human receipt.

## Fallback

If Ship24 misses a carrier or pricing changes unfavorably, keep the existing custom provider path:

```bash
LAMBENTI_TRACKING_STATUS_PROVIDER="CUSTOM_HTTP"
LAMBENTI_TRACKING_STATUS_URL_TEMPLATE="https://provider.example/status/{trackingNumber}"
LAMBENTI_TRACKING_STATUS_AUTH_TOKEN="<token>"
LAMBENTI_TRACKING_STATUS_AUTH_HEADER="authorization"
```
