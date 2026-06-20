import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Purchase Recommendations page source contract", () => {
  it("renders recommendation-to-draft-PR funnel without ordering, payment, or receiving side effects", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const actionSource = readFileSync(join(__dirname, "actions.ts"), "utf8");

    expect(pageSource).toContain("Continuous funnel from low-stock evidence to draft purchase request");
    expect(pageSource).toContain("Create Draft PR");
    expect(pageSource).toContain("Human approval and draft-PO conversion remain separate gates");
    expect(pageSource).toContain("incoming coverage");
    expect(pageSource).toContain("preferredSupplierName");
    expect(pageSource).toContain("estimatedUnitCost");
    expect(pageSource).not.toContain("DashboardTable");

    expect(actionSource).toContain("createDraftPurchaseRequest");
    expect(actionSource).toContain("purchaseRequest:draft");
    expect(actionSource).not.toContain("receivePurchaseOrderLine");
    expect(actionSource).not.toContain("markPaid");
  });
});
