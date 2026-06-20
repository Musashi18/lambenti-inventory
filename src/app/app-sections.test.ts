import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = dirname(fileURLToPath(import.meta.url));

const sections = [
  {
    route: "/accounting/customer-invoices",
    file: "accounting/customer-invoices/page.tsx",
    markers: [
      "Customer Invoices / AR",
      "getCustomerInvoiceDashboard",
      "createCustomerInvoiceAction",
      "AR invoices do not consume stock"
    ]
  },
  {
    route: "/accounting/exports",
    file: "accounting/exports/page.tsx",
    markers: [
      "GST/HST Exports",
      "getGstHstExportRows",
      "Download GST/HST CSV",
      "source evidence"
    ]
  },
  {
    route: "/accounting/landed-cost",
    file: "accounting/landed-cost/page.tsx",
    markers: [
      "Landed-Cost Allocation",
      "getLandedCostRows",
      "Download Landed-Cost CSV",
      "Recoverable GST/HST is shown but excluded"
    ]
  },
  {
    route: "/accounting/payments",
    file: "accounting/payments/page.tsx",
    markers: [
      "Payment Reconciliation",
      "getPaymentReconciliationDashboard",
      "reconciliation posts an AP payment journal",
      "Approved Invoices Ready for Payment"
    ]
  },
  {
    route: "/integrations/email-import",
    file: "integrations/email-import/page.tsx",
    markers: [
      "../alibaba-email/page",
      "export { default }"
    ]
  },
  {
    route: "/inventory/valuation",
    file: "inventory/valuation/page.tsx",
    markers: [
      "Inventory Valuation",
      "calculatePricedItemValuations",
      "ledger-derived from immutable item movements",
      "lifecycleStatus: { not: \"OBSOLETE\" }"
    ]
  },
  {
    route: "/purchasing/recommendations",
    file: "purchasing/recommendations/page.tsx",
    markers: [
      "Purchase Recommendations",
      "getPurchaseRecommendations",
      "Recommendation → Draft Purchase Request Queue",
      "createDraftPurchaseRequestFromRecommendationAction",
      "does not order, pay, or receive stock"
    ]
  },
  {
    route: "/purchasing/requests",
    file: "purchasing/requests/page.tsx",
    markers: [
      "Purchase Request Approvals",
      "approvePurchaseRequestAction",
      "convertApprovedPurchaseRequestAction",
      "Creates a draft purchase order only; inventory is still received separately through Incoming."
    ]
  }
];

describe("app section source contracts", () => {
  it.each(sections)("keeps $route wired to its domain data/actions", ({ file, markers }) => {
    const source = readFileSync(join(appRoot, file), "utf8");
    for (const marker of markers) {
      expect(source).toContain(marker);
    }
  });
});
