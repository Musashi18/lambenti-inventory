import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Purchase requests page source contract", () => {
  it("does not render an empty H1-only page when there are no requests", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(pageSource).toContain("No Purchase Requests Waiting");
    expect(pageSource).toContain("Open Recommendations");
    expect(pageSource).toContain("No ordering, payment, or stock receiving happens from this empty state");
    expect(pageSource).toContain("Create Draft PO");
    expect(pageSource).toContain("inventory is still received separately through Incoming");
  });
});
