# Hermes two-tier orchestration for Lambenti inventory work

## Purpose

Use GPT-5.5 where its judgment matters and push low-risk bounded work to the local Qwen worker so Lambenti inventory-app development stays fast without weakening ledger/accounting/product guardrails.

## Active architecture

- **Controller:** Hermes in the `lambenti` profile, primary model `gpt-5.5` through `openai-codex`.
- **Local worker:** LM Studio OpenAI-compatible API at `http://localhost:1234/v1`.
- **Worker model:** `qwen2.5-coder-7b-instruct` loaded at 32,768 context.
- **Senior model:** GPT-5.5 for senior review/escalation.
- **Concurrency target:** LM Studio `parallel=2`; Hermes delegation `max_concurrent_children=2`.

## Default Hermes profile settings

The active profile is configured so `delegate_task` children use the local endpoint by default:

```yaml
delegation:
  model: qwen2.5-coder-7b-instruct
  provider: ""
  base_url: http://localhost:1234/v1
  api_key: lm-studio
  api_mode: chat_completions
  max_iterations: 40
  child_timeout_seconds: 900
  reasoning_effort: none
  max_concurrent_children: 2
  max_spawn_depth: 1
  subagent_auto_approve: false
```

Rationale:

- `base_url` + `api_mode: chat_completions` uses LM Studio directly without making Qwen the primary Hermes controller model.
- `reasoning_effort: none` avoids Responses-style reasoning parameters on a local OpenAI-compatible endpoint.
- `max_iterations: 40` and `child_timeout_seconds: 900` prevent local workers from burning time on tasks that should escalate.
- `max_spawn_depth: 1` keeps Qwen as a leaf worker.
- `subagent_auto_approve: false` preserves human approval boundaries.

## Routing policy

### Local Qwen delegate

Use for low-risk bounded tasks:

- summarize a small set of files;
- inspect a narrow code path and report likely edit points;
- draft a first-pass patch plan;
- triage a targeted test failure;
- produce checklist/docs copy;
- review a small diff for obvious issues.

### Hermes/GPT-5.5 direct control

Use for:

- accounting correctness, AP/AR, journals, payments, landed cost, stock ledger, receiving, and Prisma migrations;
- security/auth/credentials/payment/deployment/destructive operations;
- final design judgment and final acceptance;
- ambiguous debugging after a local pass fails;
- any task where a wrong answer could corrupt data, inventory, money, supplier records, or launch decisions.

### Hybrid sanitized

Use when the repo/context is private but senior reasoning is needed:

1. Local Qwen summarizes/redacts.
2. Hermes removes secrets and private raw data.
3. GPT-5.5 reviews the sanitized bundle.
4. Hermes applies/validates any accepted changes locally.

## Delegate-task patterns

Good local child prompt:

```text
Inspect only these files: src/modules/purchasing/service.ts and src/modules/purchasing/service.integration.test.ts.
Goal: identify why finished goods might appear in purchase recommendations.
Return: findings, exact functions, and proposed test assertions. Do not edit files.
```

Bad local child prompt:

```text
Fix accounting and run all tests.
```

Why bad: too broad, side-effecting, and accounting-critical. Hermes/GPT-5.5 should own the plan and execution.

## Validation ladder

For this repo, final claims should be backed by real output from the current tree:

```bash
npm run lint
npm run typecheck
npm run test:serial
npm run build
```

For UI/server-action work, also run:

```bash
npm run start:local
```

Then browser-smoke the changed routes at `http://127.0.0.1:5173` and check console errors.

## Local worker diagnostics

Run:

```bash
npm run agent:local-worker-smoke
```

Expected: JSON with `ok: true`, the LM Studio base URL, model id, loaded models, and a short sample completion containing `HERMES_LOCAL_WORKER_OK`.

If it fails:

1. Start LM Studio server: `lms server start --port 1234`.
2. Load the worker:
   ```bash
   lms load qwen2.5-coder-7b-instruct --context-length 32768 --parallel 2 --identifier qwen2.5-coder-7b-instruct -y
   ```
3. Re-run the smoke script.
