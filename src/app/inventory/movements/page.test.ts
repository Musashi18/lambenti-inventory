import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("MovementsPage item-level movement source contract", () => {
  it("renders the item-level movement form, movement entry timestamps, and void/delete controls", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toMatch(/MovementForm/);
    expect(source).toMatch(/VoidMovementButton/);
    expect(source).toMatch(/Entry time/);
    expect(source).toMatch(/createdAt\.toLocaleString/);
    expect(source).toMatch(/Lot controls are hidden for now/);
    expect(source).not.toMatch(/include:\s*{\s*stockLots:/s);
  });

  it("hides operator-deleted stock movements and their compensating reversal rows from the recent movement list", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const dataSource = readFileSync(join(__dirname, "data.ts"), "utf8");

    expect(pageSource).toMatch(/getMovementPageData/);
    expect(dataSource).toMatch(/VOID_STOCK_MOVEMENT/);
    expect(dataSource).toMatch(/voidedMovementIds/);
    expect(dataSource).toMatch(/voidReversalRows/);
    expect(dataSource).toMatch(/reference:\s*{\s*startsWith:\s*"VOID:"/s);
    expect(dataSource).toMatch(/\.slice\("VOID:"\.length\)/);
    expect(dataSource).toMatch(/notIn:\s*voidedMovementIds/);
    expect(dataSource).toMatch(/NOT:\s*{\s*reference:\s*{\s*startsWith:\s*"VOID:"/s);
  });

  it("uses a client form with hidden lot controls, optional reason, and a BUILD movement option", () => {
    const source = readFileSync(join(__dirname, "movement-form.tsx"), "utf8");

    expect(source).toMatch(/useActionState/);
    expect(source).toMatch(/selectedItemId/);
    expect(source).toMatch(/"BUILD"/);
    expect(source).toMatch(/Reason <span[^>]*>optional/);
    expect(source).toMatch(/Build consumes active BOM component quantities per finished unit/);
    expect(source).toMatch(/Lots are intentionally hidden/);
    expect(source).not.toMatch(/name="stockLotId"/);
    expect(source).not.toMatch(/name="newLotCode"/);
    expect(source).not.toMatch(/name="newLotUnitCost"/);
  });

  it("filters BUILD item choices down to active finished BOM parent items only", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const dataSource = readFileSync(join(__dirname, "data.ts"), "utf8");
    const formSource = readFileSync(join(__dirname, "movement-form.tsx"), "utf8");

    expect(pageSource).toMatch(/buildableItemIds/);
    expect(dataSource).toMatch(/ItemCategory\.FINISHED_GOOD/);
    expect(dataSource).toMatch(/parentItemId/);
    expect(formSource).toMatch(/buildableItemIds/);
    expect(formSource).toMatch(/movementType === "BUILD"/);
    expect(formSource).toMatch(/filteredItems/);
  });
});
