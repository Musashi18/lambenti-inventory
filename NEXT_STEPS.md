# Lambenti Inventory App — Next Steps

_Last updated by Hermes after locating the Codex project._

## Located project

- **Path:** `C:/Users/musas/Desktop/lambenti-inventory`
- **App name:** `lambenti-inventory`
- **Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL, Tailwind CSS, Docker Compose
- **Verified build:** `npm run build` completed successfully on the located project.

## Current baseline

The project is already more than a placeholder. It contains:

- Prisma schema for items, suppliers, supplier offers, BOMs, stock lots, stock movements, purchase requests, purchase orders, build reservations, agent actions, and audit logs.
- Immutable stock movement ledger model; on-hand stock is derived from movements.
- UI routes for dashboard, inventory items, stock movements, valuation, suppliers, BOMs, incoming orders, purchasing recommendations, and purchase requests.
- Agent API routes for stock, BOMs, shortages, supplier offers, and draft purchase requests.
- Seed data, migration, setup docs, architecture docs, and Docker Compose.

The next work should focus on turning this into a trustworthy Lambenti operations tool rather than expanding UI surface area too early.

---

## Phase 1 — Make the local app reliably runnable

**Goal:** one command should get the app running with real database data.

1. Confirm Docker Desktop / PostgreSQL startup path.
   - Test `docker compose up -d db`.
   - Confirm Postgres is healthy.
2. Confirm `.env` is safe and not accidentally committed.
   - Keep `.env.example` as the shareable template.
   - Verify `.gitignore` excludes `.env`, `.next`, `node_modules`, and local DB artifacts.
3. Run database setup from a clean state.
   - `npm install`
   - `npx prisma generate`
   - `npx prisma migrate deploy`
   - `npx prisma db seed`
4. Open the app and verify these routes render with seeded data:
   - `/`
   - `/inventory/items`
   - `/inventory/movements`
   - `/inventory/valuation`
   - `/suppliers`
   - `/boms`
   - `/purchasing/recommendations`
   - `/purchasing/requests`
   - `/incoming`
5. Add a short `docs/local-runbook.md` once the exact working commands are confirmed on this Windows machine.

**Done when:** the app can be started from a fresh terminal without guessing commands.

---

## Phase 2 — Replace generic seed data with real Lambenti inventory

**Goal:** make the database reflect actual Lambenti Phase I operations.

Create a real initial catalog from confirmed/known items:

1. Electronics / PCB
   - ATmega328PB MCU
   - MMC5603NJ magnetometers
   - TCA9546A I2C mux
   - AP63203 buck regulator
   - IRLML6344 MOSFET
   - I2C pullups, gate resistor, gate pulldown, decoupling capacitors, inductor
   - Main PCB revisions and/or JLCPCB lots
2. LED and power
   - 12 V COB LED strip, 3000K
   - 12 V COB LED strip, 6500K
   - 12 V GS/UL power adapters
3. Cable / connector / mechanical
   - Custom UL2464 24 AWG 2C 1.5 m cables
   - Micro-Fit-compatible board headers / housings
   - Cable clamps
   - M2 screws / bolts / threaded inserts
   - Enclosure printed parts by revision
4. Packaging
   - Product box
   - Shipping box
   - Foam insert variants
   - Quick-start card / printed material
5. Finished goods / assemblies
   - Lambenti Basic finished unit
   - PCB assembly
   - LED connector assembly
   - Packaged/shippable unit

For each item, capture:

- SKU
- description
- category
- unit
- current known quantity
- storage location
- reorder point
- target stock
- lead time
- preferred supplier
- supplier SKU/link if known
- cost status: confirmed / quoted / estimated / unknown

**Done when:** generic example items like `LED-STRIP-2700K`, `PCB-CONTROL-001`, and fictional suppliers are replaced or clearly marked as demo data.

---

## Phase 3 — Tighten the data model before heavy usage

**Goal:** fix missing concepts now, before real inventory history accumulates.

Recommended schema additions:

1. **StorageLocation model**
   - Replace freeform `storageLocation` strings on items.
   - Support bins/boxes/shelves and future offsite/CM locations.
2. **Currency and cost source fields**
   - Confirmed cost vs quote vs estimate.
   - Currency, shipping included flag, DDP/FOB/etc., source document/link.
3. **Revision tracking**
   - PCB revision
   - enclosure revision
   - firmware version
   - packaging revision
4. **Build batch model**
   - batch name
   - target quantity
   - status
   - planned date
   - actual completion date
   - consumed BOM revision
5. **Unit serial model**
   - serial number
   - batch
   - PCB revision
   - firmware version
   - QA status
6. **QA log model**
   - test type
   - pass/fail
   - measured values
   - notes
   - tester
   - linked unit/batch
7. **Inbound receiving model**
   - distinguish purchase order line from actually received lot.
   - receiving should create stock lots and stock movements through one controlled workflow.

**Done when:** Phase I self-assembly can be tracked from parts received → build batch → unit serial → QA → packaged/shipped.

---

## Phase 4 — Harden inventory rules

**Goal:** make stock movements auditable and hard to corrupt.

1. Prevent negative available stock unless an explicit override reason is supplied.
2. Add validation for movement types:
   - `RECEIVE` should usually require a lot or receiving reference.
   - `CONSUME` should usually reference a build batch or unit.
   - `SCRAP` should require a reason.
   - `RESERVE` should link to a build plan/reservation.
3. Make `ADJUST` a controlled exception, not a normal workflow.
4. Add a stock movement detail page or audit drawer.
5. Add item-level ledger history:
   - chronological movements
   - running balance
   - actor
   - reference document
6. Add tests for stock math:
   - receive increases on-hand
   - consume/scrap decreases on-hand
   - reserve reduces available but not on-hand
   - adjust can increase/decrease
   - reorder recommendations use available stock, not raw on-hand only

**Done when:** inventory changes are ledger-based, explainable, and test-covered.

---

## Phase 5 — Build the purchase/request workflow correctly

**Goal:** agents can help, but humans approve anything that changes money or inventory.

1. Keep agent permission boundary:
   - Agents may read stock and supplier data.
   - Agents may create draft purchase requests.
   - Agents must not approve purchase requests.
   - Agents must not create/submit real purchase orders.
   - Agents must not create stock movements.
2. Add purchase request review UI:
   - approve
   - reject
   - request changes
   - convert to purchase order
3. Add purchase order lifecycle UI:
   - draft
   - approved
   - ordered
   - partially received
   - received
   - cancelled
4. Add receiving workflow:
   - select PO line
   - enter received quantity
   - create/assign stock lot
   - create `RECEIVE` stock movement
   - update PO received quantity/status
5. Add supplier comparison page using real Lambenti quote fields:
   - MOQ
   - unit cost by quantity tier
   - shipping
   - DDP/FOB/etc.
   - lead time
   - certifications
   - risk/quality notes

**Done when:** a real power adapter/cable/LED/PCB order can be represented from quote → request → approval → PO → receiving → stock ledger.

---

## Phase 6 — Add Lambenti production tracking

**Goal:** move beyond inventory into launch-batch execution.

1. Build batch planning:
   - choose target finished product
   - choose BOM revision
   - target quantity
   - compute shortages
   - reserve stock
2. Kitting workflow:
   - list required components
   - mark picked/short/missing
   - consume stock only when actually used or kit is committed
3. Assembly tracking:
   - unit serial assignment
   - PCB/enclosure/firmware revision assignment
   - assembly status
4. QA workflow:
   - firmware flash verification
   - sensor channel detection
   - LED PWM output check
   - no-glow hard-off check
   - magnet response check
   - visual/mechanical inspection
5. Packaging workflow:
   - accessories included
   - quick-start card included
   - box inspection
   - ready-to-ship status

**Done when:** Phase I units can be tracked individually from raw parts to ready-to-ship units.

---

## Phase 7 — Improve UX and operational visibility

**Goal:** make the app useful daily, not just technically correct.

1. Dashboard cards:
   - low stock count
   - open purchase requests
   - incoming orders
   - build readiness percentage
   - units in QA
   - ready-to-ship units
2. Filters and search:
   - SKU
   - supplier
   - category
   - lifecycle status
   - location
   - stock status
3. Import/export:
   - CSV import for initial catalog
   - CSV export for backup/spreadsheet review
   - quote import template
4. Add empty states and warnings.
5. Add destructive-action confirmations.
6. Add clear labels for demo/seed data vs real operational data.

**Done when:** Musashi can use it as the daily control panel for Lambenti parts, purchasing, and builds.

---

## Suggested first Codex task

Use this as the next prompt in Codex:

```text
You are working in the Lambenti inventory app at:
C:/Users/musas/Desktop/lambenti-inventory

Goal: harden the MVP for real Lambenti Phase I inventory tracking.

Start by inspecting README.md, NEXT_STEPS.md, prisma/schema.prisma, prisma/seed.ts, and src/modules/inventory/service.ts.

Implement Phase 3 + Phase 4 foundations:
1. Add a StorageLocation model and migrate Item.storageLocation from freeform string to a relation.
2. Add item cost/source fields sufficient to distinguish confirmed, quoted, estimated, and unknown costs.
3. Add tests for stock ledger math: receive, consume, scrap, reserve, adjust, and low-stock recommendation behavior.
4. Update seed data to use real Lambenti starter items where known, but clearly mark unknown/demo data.
5. Keep agents read-only except for creating draft purchase requests. Do not let agents approve orders, create POs, or modify stock.
6. Run Prisma generate/migration and npm run build. Report exact commands and output.

Do not overbuild dashboards until the ledger, locations, and tests are correct.
```

---

## Suggested immediate manual data-gathering checklist

Before entering real data, collect these in one sheet or note:

- Current quantities actually on hand.
- Which items are already ordered but not received.
- Supplier names and links for each order.
- Currency and whether shipping/duties are included.
- Storage bins/boxes/locations in your room/workshop.
- Which quantities are confirmed vs approximate.
- Which parts belong to one Lambenti Basic finished unit.
- Which packaging/accessory items are required per unit.

Prioritize accuracy over completeness. A small correct catalog is better than a large approximate one.
