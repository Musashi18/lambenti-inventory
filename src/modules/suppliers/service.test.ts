import { describe, expect, it } from "vitest";
import { canonicalSupplierIdentityKey, cleanConfirmedSupplierOptionName, filterOneSupplierPerSource, isConfirmedSupplierOptionCandidate, isValidSupplierIdentityName } from "./service";

describe("confirmed supplier option cleanup", () => {
  it("uses explicit company names and removes email-header wrappers from supplier option labels", () => {
    expect(cleanConfirmedSupplierOptionName({ name: "From: \"Alibaba\" <credit@notice.alibaba.com>", companyName: "JLCPCB" })).toBe("JLCPCB");
    expect(cleanConfirmedSupplierOptionName({ name: "From: Example Factory Ltd. <sales@example.com>" })).toBe("Example Factory Ltd.");
  });

  it("rejects email headings and generic imported mailbox labels while keeping confirmed suppliers", () => {
    expect(isConfirmedSupplierOptionCandidate({ name: "Subject: Your Alibaba order has shipped" })).toBe(false);
    expect(isConfirmedSupplierOptionCandidate({ name: "Alibaba supplier", emailImportCount: 3, confirmedByHuman: true })).toBe(false);
    expect(isConfirmedSupplierOptionCandidate({ name: "China DDP Supplier / Confirmed Orders", supplierOfferCount: 1, confirmedByHuman: true })).toBe(true);
    expect(isConfirmedSupplierOptionCandidate({ name: "JLCPCB", preferredItemCount: 1, confirmedByHuman: true })).toBe(true);
    expect(isConfirmedSupplierOptionCandidate({ name: "Mark Tang", companyName: "Shenzhen Mark Tang Trading Ltd.", confirmedByHuman: true })).toBe(true);
  });

  it("requires explicit human confirmation for the item preferred-supplier dropdown", () => {
    expect(isConfirmedSupplierOptionCandidate({
      name: "Verified Factory Ltd.",
      companyName: "Verified Factory Ltd.",
      contactEmail: "sales@verified.example",
      supplierOfferCount: 2,
      confirmedByHuman: false
    })).toBe(false);
    expect(isConfirmedSupplierOptionCandidate({
      name: "Verified Factory Ltd.",
      companyName: "Verified Factory Ltd.",
      contactEmail: "sales@verified.example",
      confirmedByHuman: true
    })).toBe(true);
  });

  it("rejects imported Alibaba payment and contract sentence headings even if they contain a person name", () => {
    const importedProfiles = [
      "Aimee Xia has received your initial payment for order no. 299975018501023166. View order details Total",
      "has drafted a Trade Assurance contract for you. If you are satisfied with the terms, please click the link below to send your initial payment by T/T, credit card or Online Bank Payment. Please note that different payment methods have different fee rates."
    ];

    for (const name of importedProfiles) {
      expect(isConfirmedSupplierOptionCandidate({
        name,
        contactName: name,
        emailImportCount: 1,
        invoiceCount: 1,
        purchaseOrderCount: 1,
        confirmedByHuman: true
      })).toBe(false);
    }
  });

  it("rejects Alibaba UI navigation labels and platform deep links", () => {
    const importedUiLabels = [
      "details",
      "Help & Contact",
      "Send order request",
      "to ship",
      "/apps/details?spm=a2g0o.home&id=com.alibaba.aliexpresshd",
      "Alibaba.com Singapore E-Commerce Private Limited,"
    ];

    for (const name of importedUiLabels) {
      expect(isConfirmedSupplierOptionCandidate({ name, confirmedByHuman: true })).toBe(false);
    }
  });

  it("rejects shipment-message fragments and canonicalizes real supplier duplicates", () => {
    expect(isValidSupplierIdentityName("I will send you the international tracking number as soon as the logistics company provides it to")).toBe(false);
    expect(isValidSupplierIdentityName("Mark Tang 2026-6-5 Shenzhen Sunnice Textile Co., Limited Will ship out your order soon Mark Tang")).toBe(false);
    expect(isValidSupplierIdentityName("each once.")).toBe(false);
    expect(isValidSupplierIdentityName("Huizhou Shengye Electronics Co., Ltd.")).toBe(true);
    expect(canonicalSupplierIdentityKey("Huizhou Shengye Electronics Co., Ltd.")).toBe(canonicalSupplierIdentityKey("huizhou shengye electronics ltd"));
  });

  it("filters supplier profiles to one display row per source and removes test/junk rows", () => {
    const filtered = filterOneSupplierPerSource([
      {
        id: "poorer-luma",
        name: "Luma Components duplicate",
        productPageUrl: "https://supplier.example/luma?tracking=email",
        confirmedByHuman: false,
        emailImportCount: 1
      },
      {
        id: "better-luma",
        name: "Luma Components",
        companyName: "Luma Components Ltd.",
        contactEmail: "sales@luma.example",
        contactName: "Luma Sales",
        productPageUrl: "https://supplier.example/luma/",
        confirmedByHuman: true,
        preferredItemCount: 2
      },
      {
        id: "test-row",
        name: "order TEST-EMAIL-ARCHIVE-1780819194980",
        emailImportCount: 1
      },
      {
        id: "sentence-row",
        name: "Aimee Xia has received your initial payment for order no. 299975018501023166. View order details Total",
        emailImportCount: 1
      },
      {
        id: "person-row",
        name: "Mark Tang",
        emailImportCount: 1
      },
      {
        id: "duplicate-luma",
        name: "Luma Components Ltd",
        companyName: "Luma Components Limited",
        productPageUrl: "https://supplier.example/luma",
        confirmedByHuman: true,
        preferredItemCount: 1
      },
      {
        id: "archived-row",
        name: "Archived Supplier Ltd.",
        confirmedByHuman: true,
        archivedAt: new Date("2026-06-07T00:00:00Z")
      }
    ]);

    expect(filtered.map((supplier) => supplier.id)).toEqual(["better-luma", "person-row"]);
  });
});
