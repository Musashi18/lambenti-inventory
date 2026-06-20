import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Accounting accounts page", () => {
  it("exposes one-click default AP posting setup while keeping manual mapping controls", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const actionsSource = readFileSync(join(__dirname, "actions.ts"), "utf8");

    expect(pageSource).toContain("Install Lambenti Default AP Setup");
    expect(pageSource).toContain("Creates safe starter accounts 1000/1060/1300/2000");
    expect(pageSource).toContain("upsertGLAccountAction");
    expect(pageSource).toContain("upsertGLMappingAction");
    expect(actionsSource).toContain("installDefaultApPostingSetupAction");
    expect(actionsSource).toContain("installDefaultApPostingSetup");
  });
});
