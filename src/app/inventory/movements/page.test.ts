import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("MovementsPage item-level movement source contract", () => {
  it("renders the item-level movement form, movement entry timestamps, and void/delete controls", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const globalsSource = readFileSync(join(__dirname, "../../globals.css"), "utf8");

    expect(source).toMatch(/MovementForm/);
    expect(source).toMatch(/VoidMovementButton/);
    expect(source).toMatch(/Entry Time/);
    expect(source).toMatch(/Ledger Impact/);
    expect(source).toMatch(/Balance After Entry/);
    expect(source).toMatch(/createdAt\.toLocaleString/);
    expect(source).toMatch(/balanceAfter\.onHand/);
    expect(source).toMatch(/balanceAfter\.available/);
    expect(source).toMatch(/balanceAfter\.reserved/);
    expect(source).toMatch(/Recent rows include the item balance after each visible ledger entry/);
    expect(source).toMatch(/Lot controls are hidden for now/);
    expect(source).toMatch(/table-row-interactive/);
    expect(source).toMatch(/table-sticky-cell/);
    expect(globalsSource).toContain("--table-row-hover-bg");
    expect(globalsSource).toContain("--table-sticky-cell-hover-bg");
    expect(globalsSource).toContain(".table-row-interactive:hover");
    expect(globalsSource).toContain(".table-row-interactive:hover .table-sticky-cell");
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
    expect(dataSource).toMatch(/calculateMovementBalances/);
    expect(dataSource).toMatch(/signedQuantity/);
    expect(dataSource).toMatch(/balanceAfter/);
  });

  it("uses a client form with hidden lot controls, optional reason, and a BUILD movement option", () => {
    const source = readFileSync(join(__dirname, "movement-form.tsx"), "utf8");

    expect(source).toMatch(/selectedItemId/);
    expect(source).toMatch(/"BUILD"/);
    expect(source).toContain('selectedItem?.unit === "METER"');
    expect(source).toContain('step={isMeterMovement ? "0.0001" : "1"}');
    expect(source).toMatch(/Reason <span[^>]*>Optional/);
    expect(source).toMatch(/Build consumes active BOM component quantities per finished unit/);
    expect(source).toMatch(/Lots are intentionally hidden/);
    expect(source).not.toMatch(/name="stockLotId"/);
    expect(source).not.toMatch(/name="newLotCode"/);
    expect(source).not.toMatch(/name="newLotUnitCost"/);
  });

  it("submits movement records through an explicit client handler that refreshes the list after success", () => {
    const source = readFileSync(join(__dirname, "movement-form.tsx"), "utf8");

    expect(source).toMatch(/FormEvent<HTMLFormElement>/);
    expect(source).toMatch(/event\.preventDefault\(\)/);
    expect(source).toMatch(/await createMovementAction\(undefined, new FormData\(form\)\)/);
    expect(source).toMatch(/setActionState\(result\)/);
    expect(source).toMatch(/router\.refresh\(\)/);
    expect(source).toMatch(/window\.location\.reload\(\)/);
    expect(source).not.toMatch(/useActionState/);
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
    expect(formSource).toContain("ItemSelectOptions");
    expect(formSource).toContain("sortItemsByUseGroup");
    expect(dataSource).toMatch(/category: item\.category/);
    expect(dataSource).toMatch(/unit: item\.unit/);
  });
});
