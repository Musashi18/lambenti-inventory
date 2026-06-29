import { describe, expect, it } from "vitest";
import { getAttachedLandedCostEvidenceAmount } from "./landed-cost";

describe("attached landed-cost evidence classification", () => {
  it("does not double-count an attached supplier order/payment receipt as extra landed-cost evidence", () => {
    const evidence = getAttachedLandedCostEvidenceAmount({
      originalFileName: "TA_CONTRACT_1780971366313.pdf",
      analysisJson: {
        schemaVersion: "accounting-document-v1",
        classification: "PAYMENT_RECEIPT",
        total: 145.5,
        currency: "USD"
      },
      extractedText: `
Product details
Product Quantity: 2500.00 Total Price: USD 50.00
Shipment details
Shipping method Incoterms and duties
Payment details
Full payment (USD 145.50)
Item subtotal USD 50.00
Shipping fee USD 95.50
Supplier details
`
    });

    expect(evidence).toBeNull();
  });

  it("still accepts explicit customs/duty payment receipts as landed-cost evidence", () => {
    const evidence = getAttachedLandedCostEvidenceAmount({
      originalFileName: "FedEx-clearance-duty.pdf",
      analysisJson: {
        schemaVersion: "accounting-document-v1",
        classification: "PAYMENT_RECEIPT",
        total: 80.74,
        currency: "CAD"
      },
      extractedText: "FedEx customs clearance import duty and brokerage charged 80.74 CAD"
    });

    expect(evidence).toMatchObject({ amount: 80.74, currency: "CAD" });
  });
});
