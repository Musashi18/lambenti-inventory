import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("IncomingPage receiving workbench source contract", () => {
  it("turns incoming orders into a human-counted receiving workbench", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const formSource = readFileSync(join(__dirname, "receive-line-form.tsx"), "utf8");

    expect(pageSource).toContain("Incoming / Receiving");
    expect(pageSource).toContain("getIncomingOrders");
    expect(pageSource).toContain("ReceiveIncomingLineForm");
    expect(pageSource).toContain("Email imports and invoices do not receive stock");
    expect(pageSource).toContain("Packing Slip Duplicate Check");
    expect(pageSource).toContain("batch-check the packing slip");
    expect(pageSource).toContain("groupDuplicateIncomingLines");
    expect(pageSource).toContain("Remaining Quantity");
    expect(pageSource).not.toContain("Incoming inventory tracker");
    expect(pageSource).not.toContain("DashboardTable");

    expect(formSource).toContain("receiveIncomingPurchaseOrderLineFormAction");
    expect(formSource).toContain("purchaseOrderLineId");
    expect(formSource).toContain("lotCode");
    expect(formSource).toContain("receivedAt");
    expect(formSource).toContain("unitCost");
    expect(formSource).toContain("Receive Counted Stock");
    expect(formSource).toContain("notifyIncomingLineReceived");
    expect(formSource).toContain("setTimeout(() => window.location.reload(), 550)");
    expect(pageSource).toContain("IncomingLineReceiptShell");
    expect(pageSource).toContain("formatQuantity");
    expect(readFileSync(join(__dirname, "incoming-line-receipt-shell.tsx"), "utf8")).toContain("duration-500");
    expect(formSource).toContain("Use this only after the package is physically counted");
    expect(pageSource).toContain("Receiving Progress");
    expect(pageSource).toContain("Packing Slip Duplicate Check");
  });
});
