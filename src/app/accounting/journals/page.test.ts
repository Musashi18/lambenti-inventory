import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Accounting journal page", () => {
  it("exposes a usable posted-ledger view with export and safety guardrails", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(pageSource).toContain("Journal Entries");
    expect(pageSource).toContain("Trial Balance");
    expect(pageSource).toContain("Download Journal CSV");
    expect(pageSource).toContain("AP invoice approval");
    expect(pageSource).toContain("AP payment reconciliation");
    expect(pageSource).toContain("posted balanced journals");
    expect(pageSource).toContain("does not receive stock");
    expect(pageSource).toContain("getJournalDashboard");
  });
});
