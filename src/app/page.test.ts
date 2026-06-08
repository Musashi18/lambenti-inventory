import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("DashboardPage source contract", () => {
  it("renders ledger-derived in-stock quantities on the main dashboard", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("In-stock quantities");
    expect(source).toContain("summary.stockItems");
    expect(source).toContain("Components on hand");
    expect(source).toContain("Build capacity");
    expect(source).toContain("components required per finished build");
    expect(source).toContain("Assembled packages");
    expect(source).toContain("USD $");
    expect(source).not.toContain("Total available");
    expect(source).toContain("Reserved");
    expect(source).toContain("Available");
  });
});
