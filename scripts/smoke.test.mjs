import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function appPageRoutes() {
  const appRoot = join(repoRoot, "src", "app");
  const routes = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry !== "page.tsx") continue;
      const parent = dirname(fullPath);
      const rel = relative(appRoot, parent).replace(/\\/g, "/");
      routes.push(rel === "" ? "/" : `/${rel}`);
    }
  }

  walk(appRoot);
  return routes.sort();
}

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("local smoke coverage manifest", () => {
  it("checks every app page route in scripts/smoke.mjs", () => {
    const smokeSource = readFileSync(join(repoRoot, "scripts", "smoke.mjs"), "utf8");
    const manifest = sourceBlock(smokeSource, "const pageRoutes = [", "const jsonApiRoutes");

    for (const route of appPageRoutes()) {
      expect(manifest, `scripts/smoke.mjs must include ${route}`).toContain(`"${route}"`);
    }
  });

  it("checks every app page route in the functional QA agent", () => {
    const qaSource = readFileSync(join(repoRoot, "scripts", "functional-qa-agent.mjs"), "utf8");
    const manifest = sourceBlock(qaSource, "const pageRoutes = [", "const apiRoutes");

    for (const route of appPageRoutes()) {
      expect(manifest, `functional QA route manifest must include ${route}`).toContain(`"${route}"`);
    }
  });

  it("checks every app page route in the browser section smoke", () => {
    const browserSmokeSource = readFileSync(join(repoRoot, "scripts", "browser-section-smoke.mjs"), "utf8");
    const manifest = sourceBlock(browserSmokeSource, "const pageRoutes = [", "async function main");

    for (const route of appPageRoutes()) {
      expect(manifest, `browser section smoke manifest must include ${route}`).toContain(`"${route}"`);
    }
    expect(browserSmokeSource).toMatch(/page\.on\("console"/);
    expect(browserSmokeSource).toMatch(/page\.on\("pageerror"/);
  });

  it("smokes read-only data APIs and accounting CSV export connections", () => {
    const smokeSource = readFileSync(join(repoRoot, "scripts", "smoke.mjs"), "utf8");

    for (const route of [
      "/api/atlas/mission-control",
      "/api/agent/stock",
      "/api/agent/boms",
      "/api/agent/shortages",
      "/api/agent/supplier-offers"
    ]) {
      expect(smokeSource).toContain(`"${route}"`);
    }

    for (const route of [
      "/api/accounting/exports/gst-hst",
      "/api/accounting/exports/journals",
      "/api/accounting/exports/landed-cost"
    ]) {
      expect(smokeSource).toContain(`"${route}"`);
    }
    expect(smokeSource).toMatch(/assertCsvApi/);
  });

  it("exposes reusable local runtime and UI contract smoke scripts", () => {
    const packageSource = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const runtimeSource = readFileSync(join(repoRoot, "scripts", "lambenti-runtime.mjs"), "utf8");
    const uiContractSource = readFileSync(join(repoRoot, "scripts", "ui-contract-smoke.mjs"), "utf8");
    const contextSnapshotSource = readFileSync(join(repoRoot, "scripts", "context-snapshot.mjs"), "utf8");

    expect(packageSource.scripts["lambenti:serve:verified"]).toContain("scripts/lambenti-runtime.mjs ensure --build --restart");
    expect(packageSource.scripts["context:snapshot"]).toContain("scripts/context-snapshot.mjs");
    expect(packageSource.scripts["runtime:status"]).toContain("scripts/lambenti-runtime.mjs status");
    expect(packageSource.scripts["runtime:ensure"]).toContain("scripts/lambenti-runtime.mjs start");
    expect(packageSource.scripts["smoke:ui-contracts"]).toContain("scripts/ui-contract-smoke.mjs");
    expect(packageSource.scripts["verify:tiny-ui"]).toContain("smoke:ui-contracts");
    expect(runtimeSource).toContain("lambenti-local-server.json");
    expect(runtimeSource).toContain("sourceFingerprint");
    expect(runtimeSource).toContain("--max-old-space-size=6144");
    expect(uiContractSource).toContain("sidebar-dark-hover");
    expect(uiContractSource).toContain("table-row-interactive");
    expect(uiContractSource).toContain("Fix Failed");
    expect(contextSnapshotSource).toContain("TOKEN-EFFICIENT CONTEXT SNAPSHOT");
    expect(contextSnapshotSource).toContain("suppressedGitWarnings");
    expect(contextSnapshotSource).toContain("rerun with --paths=<relevant paths>");
  });
});
