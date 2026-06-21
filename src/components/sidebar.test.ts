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

  it("keeps the movements navigation as a plain high-z-index anchor so wide item tables cannot trap clicks", () => {
    const source = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");

    expect(source).toContain('href: "/inventory/movements", label: "Movements"');
    expect(source).toContain("isolate relative z-50");
    expect(source).toContain("relative z-10 flex items-center");
    expect(source).toContain("<a");
    expect(source).not.toContain("next/link");
  });
});