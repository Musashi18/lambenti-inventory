# Lambenti Inventory App Instructions

This repository is Lambenti's operational inventory, purchasing, landed-cost, supplier, email-import, BOM, valuation, and accounting system.

## Core business rules

- The app database is the source of truth for operational state.
- Do not invent suppliers, costs, SKUs, purchase orders, invoices, received quantities, or BOM lines.
- Email/order imports may create ORDERED incoming purchase orders.
- Email/order imports must not receive physical stock.
- Invoices/accounting must not mutate physical inventory.
- Receiving physical stock requires an explicit inventory receiving/movement action.
- Cost updates must preserve provenance: supplier, source email/order, quote reference, confidence, timestamp, and actor when available.
- All related sections should stay synchronized after mutations through shared revalidation.
- Temporary verification data must use obvious `TEST-*` identifiers and must be cleaned up before finishing.

## Lambenti product assumptions

- Main product: Lambenti Basic, a magnetically interactive ambient lighting product.
- Current product focus: triple magnetometer, 12 V single-channel white LED, no visible controls/app/voice.
- Phase I target: roughly 50 self-assembled units.
- Phase II target: roughly 200 units.
- Track BOM completeness, suppliers, landed cost, reorder risk, incoming orders, invoices, stock movements, and margin.
- Treat future dual-white/Plus, Pro/RGB, and six-sensor concepts as exploratory unless explicitly requested.

## Development rules

- Use Prisma migrations for schema changes; never hand-edit production database shape without a migration.
- After schema changes, run:
  - `npx prisma migrate deploy`
  - `npx prisma generate`
- For app verification, run from the current tree:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test -- --run --no-file-parallelism` or `npm run test:serial`
  - `npm run build`
- Browser-test changed flows at `http://127.0.0.1:5173` when UI/actions are touched; for production smoke use `npm run start:local` and check rendered content plus console errors.
- Use the local scripts:
  - `npm run dev:local` for development server
  - `npm run start:local` for production smoke testing
- On Windows, Prisma generation can fail if a Node/Next process is locking the query-engine DLL. Kill the process owning port 5173, then rerun generate/build.
- Do not stop after writing code. Verify with real test/build/browser/tool output, or clearly report the blocker.

## Important app flows

- Item creation must show inline success/error feedback.
- Duplicate SKUs must never crash the page.
- Email Import must re-match old imported lines against the current item catalog before applying.
- Applying an email import creates ordered PO lines and leaves received quantity at zero.
- Invoicing creates AP/accounting records and does not receive stock.
- Stock quantity changes must be explicit inventory movements or receiving actions.
- Reorder recommendations, valuation, incoming, invoices, and dashboard pages should refresh after relevant mutations.

## Preferred Hermes workflow

- Load the `lambenti-tracking-app-development` skill before modifying this app.
- For broad, continuation, recovery, or multi-domain work, also load `lambenti-parallel-engineering-operator`.
- This repo uses the Lambenti two-tier orchestration default: Hermes/GPT-5.5 stays the controller/senior reviewer, and low-risk bounded `delegate_task` children default to local Qwen2.5-Coder through LM Studio.
- Use local Qwen delegates for read-only audits, file summaries, small draft plans, targeted test triage, and narrow low-risk code-review passes; keep accounting/ledger/migration/security/production/destructive decisions under Hermes/GPT-5.5 control.
- Treat delegate summaries as advisory self-reports; verify claimed file changes, test results, and runtime behavior yourself before finalizing.
- Keep local delegates leaf/bounded: pass small context bundles and narrow toolsets, and avoid sending secrets or raw private data to remote models.
- Before planning continuation work, read `HERMES_STATE.md`, `TASK_QUEUE.md`, `DECISIONS.md`, and `ISSUES.md` when they exist.
- Use `systematic-debugging` for regressions and production-only errors.
- Use `test-driven-development` when adding business logic or bugfix coverage.
- Keep durable procedures in skills; keep operational facts in the database.
- Use session search for prior conversation context instead of asking the user to repeat old decisions.
- See `docs/hermes-two-tier-orchestration.md` for the local-worker diagnostics and routing details.
