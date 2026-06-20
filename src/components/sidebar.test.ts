import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Sidebar branding source contract", () => {
  it("uses Inventory and Sourcing as the primary sidebar title without visible Lambenti wordmark text", () => {
    const source = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");

    expect(source).toContain("Inventory and Sourcing");
    expect(source).toContain("px-3 text-xl font-semibold text-ink");
    expect(source).not.toMatch(/>Lambenti</);
  });
});