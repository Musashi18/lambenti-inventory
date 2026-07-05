# Atlas Recursive Improvement Loop Plan

> **For Hermes:** Use the Lambenti inventory app verification ladder and keep Atlas read-only unless Musashi explicitly authorizes a mutation path. Do not use this loop to receive stock, approve/pay invoices, create purchase orders, run Alibaba capture, or send supplier messages.

**Goal:** Run a focused 1-hour recursive loop that improves Project Atlas functionality and security by repeatedly selecting the highest-leverage small fix, implementing it, verifying it, and updating the next iteration backlog.

**Architecture:** Atlas remains a read-only Founder OS surface over existing dashboard, tracking, accounting, automation, and Founder OS activity evidence. Improvements should reinforce least-privilege access, server-side input validation, evidence provenance, uncertainty labeling, and operator-useful decision surfaces.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, existing Lambenti auth/permissions model, `src/modules/atlas/*`, `/atlas`, `/atlas/overlay`, `/atlas/simulator`, managed local runtime at `http://127.0.0.1:5173`.

---

## Current Context

Implemented in the current pass:

- Added `atlas:view` permission in `src/modules/auth/permissions.ts`.
- Human operator roles retain Atlas access; `AGENT` does not.
- `/atlas`, `/atlas/overlay`, and `/atlas/simulator` now require `atlas:view` instead of generic `item:view`.
- `/atlas/simulator` focus-hours input is server-side bounded to `1..12` hours/day in `0.5h` increments, with non-finite input falling back to `6`.
- Verification passed: targeted tests, typecheck, lint, 6144 MB build, full serial Vitest, runtime route probes, UI-contract smoke, browser `/atlas` console/DOM check, and HTTP clamp evidence for `hours=999`.

External research anchors:

- OWASP Authorization Cheat Sheet: least privilege and deny-by-default.
- OWASP Input Validation Cheat Sheet: server-side validation and allowlisting; client-side controls are not security.

---

## 1-Hour Recursive Loop

### Minute 0–5: Snapshot and Select

**Objective:** Start each loop from current evidence, not memory.

**Commands:**

```bash
npm run context:snapshot -- --paths=src/app/atlas,src/modules/atlas,src/modules/auth,src/app/api,scripts/ui-contract-smoke.mjs
npm run runtime:status --if-present
```

**Select one candidate from the backlog by:**

1. Security risk reduction.
2. Operator usefulness.
3. Low blast radius.
4. Testability in under 20 minutes.
5. No operational side effects.

---

### Minute 5–15: RED / Probe

**Objective:** Prove the selected gap with a test or deterministic probe.

**Default test targets:**

```bash
npm run test -- src/modules/auth/permissions.test.ts src/modules/atlas/scenarios.test.ts src/modules/atlas/scoring.test.ts src/modules/atlas/activity-events.test.ts src/modules/atlas/service.test.ts -- --run --no-file-parallelism
```

**If UI-only:** add/update source-contract expectations and run:

```bash
npm run smoke:ui-contracts
```

---

### Minute 15–35: Implement Small Fix

**Objective:** Change only the files implicated by the failing test/probe.

**Likely safe Atlas files:**

- `src/modules/atlas/scoring.ts`
- `src/modules/atlas/scenarios.ts`
- `src/modules/atlas/activity-events.ts`
- `src/modules/atlas/evidence-adapters.ts`
- `src/app/atlas/page.tsx`
- `src/app/atlas/overlay/page.tsx`
- `src/app/atlas/simulator/page.tsx`
- `src/modules/auth/permissions.ts`
- `src/modules/auth/permissions.test.ts`

**Rules:**

- Keep Atlas read-only.
- Prefer typed helper functions over inline defensive hacks.
- Do not invent precision; widen intervals or show unknown when evidence is weak.
- Do not display raw private paths/source refs unless the operator value is clear.
- Every user-supplied query/input must be allowlisted or bounded server-side.

---

### Minute 35–50: Verify

**Minimum verification after code changes:**

```bash
npm run test -- src/modules/auth/permissions.test.ts src/modules/atlas/scenarios.test.ts src/modules/atlas/scoring.test.ts src/modules/atlas/activity-events.test.ts src/modules/atlas/service.test.ts -- --run --no-file-parallelism
npm run typecheck
npm run lint
```

**Escalate when touched files include UI/routes/auth:**

```bash
NODE_OPTIONS='--max-old-space-size=6144' npm run build
MSYS_NO_PATHCONV=1 npm run lambenti:serve:verified -- --routes=/atlas,/atlas/overlay,/atlas/simulator
npm run smoke:ui-contracts
```

**Browser evidence:**

- Navigate to `http://127.0.0.1:5173/atlas`.
- Check: `Mission Control`, `Atlas Visual Command Deck`, no horizontal overflow, no console/JS errors.
- For simulator input changes, fetch a malicious or out-of-range query and verify it is bounded or rejected.

---

### Minute 50–60: Record and Recurse

**Objective:** Leave the next loop easier than this one.

Update if substantial:

- `HERMES_STATE.md`
- `TASK_QUEUE.md`
- `DECISIONS.md`
- `ISSUES.md`

Record:

- What changed.
- Why it was highest leverage.
- Exact verification commands/results.
- Side effects avoided.
- Next best candidate.

Then restart the loop with a fresh snapshot.

---

## Prioritized Backlog for Next Atlas Loop

### 1. Atlas evidence privacy tiering

**Why:** Atlas aggregates sensitive operational evidence. Even human viewers may not need raw low-level evidence details.

**Implement:** add display-tier helpers that classify evidence summaries as public/operator/internal and ensure UI shows summaries without raw source refs or private paths by default.

**Tests:** page/source tests that `sourceRef` values are not rendered unless an explicit internal/debug mode exists.

---

### 2. Atlas stale-evidence detection

**Why:** `staleEvidenceCount` currently stays `0`; that can overstate confidence.

**Implement:** compute staleness by source type and `observedAt` age. Show stale count and lower confidence when evidence is old.

**Tests:** scoring test with old evidence lowers confidence and increments stale count.

---

### 3. Scenario tamper logging / explicit invalid-state copy

**Why:** OWASP recommends treating fixed-option tampering as significant. Current invalid scenario falls back safely, but operator/debug visibility is low.

**Implement:** when an invalid scenario kind is supplied, show default scenario set with a small safe `Invalid scenario ignored` message, or record a non-secret server log.

**Tests:** route/component test for invalid scenario fallback copy.

---

### 4. Atlas API boundary decision

**Why:** Atlas has no JSON route yet. If future agents or overlays need data, add a dedicated authenticated read-only API instead of scraping HTML.

**Implement:** `/api/atlas/mission-control` with `atlas:view` or a separate `agentApi:read + atlas:read` policy, `Cache-Control: private, no-store`, and no mutation.

**Tests:** API auth/security contract + snapshot of JSON shape.

---

### 5. Overlay operating value

**Why:** `/atlas/overlay` is useful but still static; it should become the daily execution nudge.

**Implement:** add one next action, one risk, one velocity caveat, and one confidence marker in compact overlay form.

**Tests:** source/page marker test and browser smoke.

---

## Stop Conditions

Stop the loop and report instead of continuing if:

- A verification gate fails for a reason not localized to Atlas.
- The next change would require a Prisma migration.
- The next change would mutate stock/accounting/purchasing/tracking/Alibaba state.
- Security work requires choosing a new auth policy beyond `atlas:view`.
- Runtime/browser smoke reveals stale-server drift that needs cleanup before code work.
