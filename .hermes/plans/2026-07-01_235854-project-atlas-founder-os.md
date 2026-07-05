# Project Atlas Founder OS Implementation Plan

> **For Hermes:** If executing this plan, load `lambenti-autonomous-execution-standard`, `lambenti-parallel-engineering-operator`, `lambenti-tracking-app-development`, and `software-debug-quality-workflows` before modifying app code. Use local Qwen only for bounded read-only audits/drafts; Hermes/GPT controls schema, scoring, side effects, and final verification.

**Goal:** Build Project Atlas as a local-first Founder Operating System for Lambenti that models company state as an evidence-backed dependency graph, predicts launch/company trajectory, and shows the single highest-leverage next action.

**Architecture:** Start with an Atlas Kernel inside the existing Lambenti inventory app because it already contains the strongest operational truth: inventory, BOMs, purchasing, receiving, tracking, accounting evidence, automation findings, and launch-readiness summaries. Then wrap/extend it into a cross-platform desktop shell with an optional transparent overlay once the scoring model and dashboard are useful. This avoids building a beautiful empty desktop shell before the evidence engine exists.

**Tech Stack:** Current app: Next.js 15.5.19, React 19.1, Prisma 6.8, PostgreSQL, Vitest, Tailwind. Desktop phase: Electron recommended for overlay/window/activity-source maturity across Windows/macOS/Linux; Tauri can be revisited if binary size matters more than overlay/system API speed.

---

## Current Context / Evidence Inspected

- Repo: `C:/Users/musas/Desktop/lambenti-inventory`.
- Current app already has operational launch data in `src/modules/dashboard/service.ts` via `getDashboardSummary()` with `launchReadiness` and `dashboardGraphs`.
- Current app already has tracking/logistics data in `src/modules/tracking/service.ts` via `getTrackingDashboard()` and lead-time learning via `getLeadTimeLog()` / `getLeadTimeSummaryIndex()`.
- Current app already has purchasing and receiving flows in `src/modules/purchasing/service.ts` and `src/modules/purchasing/receiving.ts`.
- Current app already has accounting source evidence in `src/modules/accounting/documents.ts` via `getAccountingWorkbench()`.
- Current app already has automation findings in `src/modules/automation/service.ts` via `getAutomationOverview()`.
- Repo guardrails from `AGENTS.md`: DB is source of truth; no stock changes without explicit receiving/movement; accounting/apply must not receive stock; supplier/order/invoice facts must not be invented.
- Dirty tree existed before this plan. Do not overwrite unrelated current work. Use narrow patches and verify `git status --short` before implementation.

---

## Product Non-Negotiables

1. **Evidence first.** Atlas must never invent supplier state, shipping dates, costs, cash runway, customer feedback, or progress.
2. **No time-only progress.** Time spent may affect velocity/burnout estimates, but completion increases only from validated artifacts or explicit evidence events.
3. **Intervals over false precision.** Predictions show probability ranges/confidence intervals and evidence coverage; avoid fake `+9.4%` precision until calibrated by data.
4. **Decision support, not surveillance.** Passive collection is opt-in, local-first, inspectable, and confidence-scored. Sensitive source text is redacted/minimized before storage.
5. **No shame, no flattery.** Reality Engine statements must identify opportunity cost objectively and cite supporting evidence.
6. **Preserve Lambenti boundaries.** Atlas may recommend; it must not approve purchases, pay invoices, receive stock, send supplier messages, or mutate accounting/stock without explicit human action through existing gates.

---

## Recommended Build Strategy

### Phase A — Atlas Kernel in Existing App

Build `/atlas` as a read-only command layer over the current operational DB.

Why first:

- Existing app already knows the near-term company truth: launch readiness, BOM bottlenecks, incoming orders, tracking risks, invoice blockers, supplier state, valuation, and automation findings.
- Atlas scoring can be tested against current data without desktop/window-capture complexity.
- This produces a usable mission-control surface quickly and avoids overbuilding passive tracking before the company model exists.

### Phase B — Local Evidence Collectors

Add local, opt-in collectors for file/git/activity/calendar/email metadata. Store source snapshots separately from derived Atlas conclusions.

### Phase C — Desktop Shell + Overlay

Package the Atlas UI as a cross-platform desktop app. The overlay shows only the minimal live metrics after the scoring model is proven useful.

---

## Initial Atlas Domain Model

Add these models only after a focused schema-review pass. Names are intentionally Atlas-scoped to avoid contaminating inventory/accounting semantics.

**Modify:** `prisma/schema.prisma`

Proposed entities:

- `AtlasNode`
  - `id`
  - `slug` unique, e.g. `phase1.ship-first-production-unit`, `engineering.firmware`, `manufacturing.supplier-qualification`
  - `title`
  - `kind` enum: `COMPANY`, `HORIZON`, `PROJECT`, `WORKSTREAM`, `MILESTONE`, `RISK`, `TASK`
  - `status` enum: `NOT_STARTED`, `ACTIVE`, `BLOCKED`, `COMPLETE`, `PAUSED`
  - `completionPct` decimal 0–100
  - `confidencePct` decimal 0–100
  - `estimatedHoursRemaining`
  - `businessImpactScore` 0–100
  - `riskScore` 0–100
  - `lastModifiedAt`
  - `createdAt`, `updatedAt`

- `AtlasDependency`
  - `id`
  - `fromNodeId`
  - `toNodeId`
  - `relationship` enum: `BLOCKS`, `SUPPORTS`, `EVIDENCES`, `REDUCES_RISK`, `INCREASES_RISK`
  - `weight` decimal

- `AtlasEvidence`
  - `id`
  - `nodeId`
  - `sourceType` enum: `INVENTORY`, `BOM`, `PURCHASING`, `TRACKING`, `ACCOUNTING`, `GIT`, `FILE`, `HERMES_MEMORY`, `CALENDAR`, `EMAIL`, `MANUAL`, `EXTERNAL_ANALYTICS`
  - `sourceRef`
  - `summary`
  - `confidencePct`
  - `observedAt`
  - `payloadJson`

- `AtlasActivityEvent`
  - `id`
  - `category` enum from the user’s taxonomy
  - `leverageTier` enum: `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`
  - `confidencePct`
  - `startedAt`, `endedAt`
  - `sourceType`, `sourceRef`
  - `summary`
  - `validatedProgress` boolean
  - `nodeId?`

- `AtlasProjectionSnapshot`
  - `id`
  - `generatedAt`
  - `launchProbabilityP50`, `launchProbabilityLow`, `launchProbabilityHigh`
  - `projectedLaunchDateP50`, `projectedLaunchDateLow`, `projectedLaunchDateHigh`
  - `cashShortageRiskLow/P50/High`
  - `burnoutRiskLow/P50/High`
  - `firstBatchSuccessLow/P50/High`
  - `supportingEvidenceJson`
  - `assumptionsJson`

- `AtlasScenario`
  - saved what-if assumptions and resulting projection snapshot reference.

**Migration commands after schema edit:**

```bash
npx prisma migrate dev --name atlas_kernel
npx prisma generate
```

---

## MVP Module Layout

Create these files for Phase A:

- `src/modules/atlas/types.ts`
  - shared TypeScript types for nodes, evidence, scoring outputs, scenarios, activity categories.

- `src/modules/atlas/seed-graph.ts`
  - deterministic initial Lambenti dependency graph from the Project Atlas brief:
    - Phase 1: ship first production unit, first customer order, first batch, excellent customer experience.
    - Phase 2: first 50 units, reviews, repeatable production.
    - Phase 3: scale manufacturing, product line, design brand.
    - Phase 4: profitability, team, international expansion, acquisition/independent path.
  - No invented completion data; initial completion comes from evidence adapters.

- `src/modules/atlas/evidence-adapters.ts`
  - read-only adapters that convert existing app truth into Atlas evidence:
    - `getDashboardSummary()` → launch readiness, BOM bottlenecks, inventory valuation, low-stock pressure.
    - `getTrackingDashboard()` → shipment/tracking risk, lead-time samples.
    - `getPurchaseRecommendations()` / incoming orders → supplier/manufacturing readiness.
    - `getAccountingWorkbench()` → finance/accounting document blockers.
    - `getAutomationOverview()` → known open findings/failures.

- `src/modules/atlas/scoring.ts`
  - pure functions only; easy to test.
  - Inputs: node graph, evidence, activity events, explicit assumptions.
  - Outputs: mission completion, current company completion, launch probability interval, bottleneck, largest risk, highest-leverage task, confidence.

- `src/modules/atlas/service.ts`
  - `getAtlasMissionControl()` server-side read model that assembles evidence, scores graph, returns UI DTO.
  - Must be read-only in v0.

- `src/modules/atlas/scenarios.ts`
  - pure simulation functions for what-if scenarios: hours/day, outsourcing PCB assembly, hiring help, delaying packaging, launching before perfection.

- `src/app/atlas/page.tsx`
  - Mission Control dashboard.

- `src/app/atlas/simulator/page.tsx`
  - Predictive Simulator form/UI, initially client-side over server-provided baseline assumptions.

- `src/app/atlas/page.test.tsx` or module-focused tests first if page test harness is heavy.

- `src/modules/atlas/scoring.test.ts`
  - unit tests for probability intervals, bottleneck selection, leverage ranking, no-time-only-progress behavior.

- `src/modules/atlas/evidence-adapters.test.ts`
  - contract tests that existing app evidence maps to stable Atlas signals without mutation.

---

## Phase A Task Breakdown

### Task 1: Create Atlas Read Model Without New Database Tables

**Objective:** Build a no-migration first slice so Atlas can render real current data without risking schema churn.

**Files:**
- Create: `src/modules/atlas/types.ts`
- Create: `src/modules/atlas/seed-graph.ts`
- Create: `src/modules/atlas/scoring.ts`
- Create: `src/modules/atlas/scoring.test.ts`

**Acceptance:**
- `npm run test -- src/modules/atlas/scoring.test.ts -- --run --no-file-parallelism` passes.
- Tests prove completion cannot increase from an `AtlasActivityEvent` unless `validatedProgress=true` or evidence supports node state change.

### Task 2: Add Evidence Adapters Over Existing App Truth

**Objective:** Convert current inventory/tracking/accounting/purchasing/automation facts into Atlas evidence objects.

**Files:**
- Create: `src/modules/atlas/evidence-adapters.ts`
- Create: `src/modules/atlas/evidence-adapters.test.ts`
- Modify only if needed: existing module exports; avoid changing behavior.

**Acceptance:**
- Adapter tests confirm:
  - launch-readiness evidence comes from `getDashboardSummary()`;
  - tracking risk evidence comes from `getTrackingDashboard()`;
  - accounting blocker evidence comes from `getAccountingWorkbench()`;
  - no adapter creates purchase requests, receives stock, posts journals, or runs Alibaba capture.

### Task 3: Build `getAtlasMissionControl()`

**Objective:** Produce one typed DTO for the homepage mission-control view.

**Files:**
- Create: `src/modules/atlas/service.ts`
- Create: `src/modules/atlas/service.test.ts`

**Output shape:**

```ts
type AtlasMissionControl = {
  missionCompletionPct: number;
  companyCompletionPct: number;
  launchProbability: { low: number; p50: number; high: number; confidencePct: number };
  projectedLaunchDate: { low: string | null; p50: string | null; high: string | null; confidencePct: number };
  remainingHours: number | null;
  weeklyVelocity: { currentHours: number | null; requiredHours: number | null; confidencePct: number };
  currentBottleneck: AtlasRankedSignal | null;
  largestRisk: AtlasRankedSignal | null;
  highestLeverageTask: AtlasOpportunity | null;
  strategicRadar: AtlasRadarSector[];
  momentum: AtlasMomentumSummary;
  graph: AtlasGraphDto;
  evidenceCoverage: AtlasEvidenceCoverage;
};
```

**Acceptance:**
- Service returns a stable DTO from current DB state.
- Missing data lowers confidence instead of fabricating precision.

### Task 4: Implement `/atlas` Mission Control Page

**Objective:** Add a premium, decision-dense dashboard that answers “what should I do next?” without decorative metrics.

**Files:**
- Create: `src/app/atlas/page.tsx`
- Modify: `src/components/sidebar.tsx` only to add navigation if desired.
- Optional create: `src/components/atlas/*` if page becomes too large.

**Required visible sections:**
- Mission Completion
- Current Company Completion
- Launch Probability interval
- Projected Launch Date interval
- Confidence / evidence coverage
- Remaining Hours
- Current Weekly Velocity / Required Weekly Velocity
- Current Bottleneck
- Largest Risk
- Highest-Leverage Task
- Strategic Radar
- Progress Galaxy dependency graph, static first; no decorative animation.
- Reality Engine statement when low-leverage or low-evidence pattern is detected.

**Acceptance:**
- Browser smoke at `http://127.0.0.1:5173/atlas` shows dark theme, no console/page errors, no horizontal overflow.
- Text avoids fake precision when data coverage is low.

### Task 5: Add Predictive Simulator Pure Model

**Objective:** Enable what-if reasoning without pretending projections are more certain than inputs.

**Files:**
- Create: `src/modules/atlas/scenarios.ts`
- Create: `src/modules/atlas/scenarios.test.ts`
- Create: `src/app/atlas/simulator/page.tsx`

**Initial scenarios:**
- work 6 focused hours/day;
- outsource PCB assembly;
- hire manufacturing help;
- delay packaging;
- launch before perfecting every detail.

**Acceptance:**
- Scenarios update timeline/probability/risk with visible assumptions.
- Tests cover monotonic expectations, e.g. more validated execution capacity can improve timeline, but cannot overcome a hard manufacturing blocker unless the scenario changes that blocker.

### Task 6: Add Persistent Atlas Tables

**Objective:** Persist graph nodes, evidence, activity events, projection snapshots, and scenarios after the read-only UI proves useful.

**Files:**
- Modify: `prisma/schema.prisma`
- Create migration: `prisma/migrations/<timestamp>_atlas_kernel/migration.sql`
- Create: `src/modules/atlas/persistence.ts`
- Create: `src/modules/atlas/persistence.integration.test.ts`

**Acceptance:**
- `npx prisma migrate dev --name atlas_kernel`
- `npx prisma generate`
- integration tests prove inserts are Atlas-only and do not mutate inventory/accounting/purchasing/stock tables.

### Task 7: Local Activity Snapshot Collector

**Objective:** Begin opt-in data collection for momentum/velocity without surveillance ambiguity.

**Files:**
- Create: `scripts/atlas-activity-snapshot.mjs` or profile-local Python if OS-level APIs are needed.
- Create: `scripts/atlas-activity-export.mjs`
- Create: `docs/atlas-data-sources.md`

**Data captured initially:**
- Git repo touched, branch, diff-stat size, recent commits.
- Foreground app/window title only when user explicitly enables OS permission.
- Recent modified files under Lambenti workspaces.
- Hermes founder-os snapshots if present.
- No raw email/browser content in v0; capture metadata only unless explicitly enabled.

**Acceptance:**
- Snapshot script writes JSONL locally and stays silent on success.
- Export script creates a redacted evidence packet.
- Collector can be disabled by config/env.

### Task 8: Desktop Shell and Overlay

**Objective:** Convert Atlas from an app route into a cross-platform desktop app with optional overlay.

**Recommended path:** Electron first.

**Files / package direction:**
- If monorepo conversion is acceptable:
  - Create: `apps/atlas-desktop/package.json`
  - Create: `apps/atlas-desktop/src/main.ts`
  - Create: `apps/atlas-desktop/src/preload.ts`
  - Create: `apps/atlas-desktop/src/overlay.ts`
- If keeping single-package repo:
  - Add Electron config under `desktop/atlas/` and keep Next app as renderer.

**Overlay requirements:**
- transparent, always-on-top, click-through toggle;
- shows only mission progress, deep work today, focus timer, highest-leverage task, velocity, remaining hours this week;
- no progress increase from timer alone;
- privacy pause / hide hotkey.

**Acceptance:**
- Windows smoke first on Musashi’s machine.
- Then macOS/Linux packaging checks once the product kernel is useful.

---

## Scoring Model Rules

### Completion

Node completion should combine:

- explicit node state/evidence;
- dependency completion;
- risk penalties;
- evidence freshness;
- confidence coverage.

Do not directly add hours to completion. Hours can update velocity and projected completion date only.

### Launch Probability

Initial launch probability should be a heuristic interval, not a precise forecast:

- Base from Phase 1 node completion.
- Adjust down for unresolved blockers: BOM bottleneck, supplier gaps, tracking delays, accounting blockers, QA/test gaps, customer validation gaps.
- Adjust up for validated shipping-critical artifacts: assembled/package-ready units, received components, successful firmware/hardware tests, supplier qualification, live website/customer order readiness.
- Confidence interval width expands when evidence coverage is low or stale.

### Opportunity Engine

Expected value of next task:

```text
expected_probability_gain = blocker_weight × business_impact × confidence × dependency_unlock_factor / estimated_hours
```

Display as a range until calibrated. Example: `estimated +2–6 points`, not `+4.37%`.

### Reality Engine

Only generate critiques when supported by data. Example rule:

- If low-leverage events exceed 35% of classified founder time for the week **and** a high-impact blocker remains open, render a neutral opportunity-cost statement with evidence.
- If data coverage is under threshold, state: `Atlas does not yet have enough activity coverage to judge leverage reliably.`

---

## Visual Direction

- Dark aerospace mission-control surface.
- Lambenti brand restraint: quiet, premium, no confetti, no gamification.
- Typography: use existing app type scale unless adding a deliberate font dependency later.
- Motion: subtle state transitions only; animations must encode progress/dependency/risk changes.
- Progress Galaxy is acceptable only if it remains an information visualization: node brightness = validated progress × confidence; connection intensity = dependency weight/risk.

---

## Verification Ladder

For Phase A code:

```bash
npm run test -- src/modules/atlas/scoring.test.ts src/modules/atlas/evidence-adapters.test.ts src/modules/atlas/service.test.ts -- --run --no-file-parallelism
npm run typecheck
npm run lint
npm run test:serial
NODE_OPTIONS='--max-old-space-size=6144' npm run build
npm run lambenti:serve:verified -- --routes=/atlas,/atlas/simulator,/
npm run smoke:ui-contracts
```

For desktop/overlay phase:

- Unit tests for overlay state.
- Manual Windows overlay smoke.
- Permission/privacy smoke: disable collector, pause overlay, verify no snapshots are written.
- No secret scan / no raw credential capture.

---

## Key Risks

1. **False precision risk:** probability models can become theater. Mitigation: intervals, evidence coverage, source drill-down, calibration logs.
2. **Over-instrumentation risk:** collecting everything before modeling useful signals delays value. Mitigation: launch with existing DB + Git/checkpoint evidence first.
3. **Privacy/sensitivity risk:** browser/email/history capture can store too much. Mitigation: opt-in, local-only, metadata-first, redaction, source allowlists.
4. **Decorative dashboard risk:** mission-control UI can become cinematic but useless. Mitigation: every panel must answer blocked/changed/next/trust.
5. **Scope explosion risk:** desktop, overlay, AI coaching, simulator, knowledge graph, and data collectors are multiple products. Mitigation: build Atlas Kernel first, then overlay.
6. **Model authority risk:** AI recommendations must not directly trigger purchases, stock moves, payments, supplier messages, or accounting posts.

---

## Recommended First Build Slice

Implement Phase A Tasks 1–4 only:

1. Pure Atlas types/graph/scoring.
2. Evidence adapters over existing app truth.
3. `getAtlasMissionControl()` read model.
4. `/atlas` Mission Control page.

Do not start with desktop overlay. The overlay is only powerful after Atlas can identify the true highest-leverage task from real Lambenti evidence.

**Definition of done for first slice:** `/atlas` loads from live local data and truthfully answers:

- What is the current launch-readiness state?
- What is the current bottleneck?
- What is the largest risk?
- What is the highest-leverage next action?
- How confident is Atlas, and which evidence supports that answer?
