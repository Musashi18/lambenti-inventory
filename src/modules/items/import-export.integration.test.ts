import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  exportItemsToCsv,
  importItemsFromCsv,
  previewItemCsvImport
} from "./import-export";

const TEST_PREFIX = "TEST-ITEM-IMPORT";

async function cleanupTestData() {
  const items = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createLocation(suffix: string) {
  return prisma.storageLocation.create({
    data: {
      code: `${TEST_PREFIX}-${suffix}-LOC`,
      name: `Import test location ${suffix}`
    }
  });
}

describe("item CSV import/export", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("exports item rows with stable headers and CSV escaping", () => {
    const csv = exportItemsToCsv([
      {
        sku: `${TEST_PREFIX}-EXPORT-1`,
        description: "Warm LED strip, 3000K",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 10,
        targetStock: 100,
        leadTimeDays: 21,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        manufacturerPartNo: "",
        supplierSku: "SUP-1",
        preferredSupplierId: "",
        estimatedUnitCost: 1.23,
        costCurrency: "USD",
        costConfidence: "CONFIRMED",
        costSourceRef: "Quote \"A\""
      }
    ]);

    expect(csv).toBe([
      "sku,description,category,unit,reorderPoint,targetStock,leadTimeDays,lifecycleStatus,manufacturerPartNo,supplierSku,preferredSupplierId,estimatedUnitCost,costCurrency,costConfidence,costSourceRef",
      `${TEST_PREFIX}-EXPORT-1,"Warm LED strip, 3000K",COMPONENT,EACH,10,100,21,ACTIVE,,SUP-1,,1.23,USD,CONFIRMED,"Quote ""A"""`
    ].join("\n"));
  });

  it("previews CSV imports and reports all duplicate, existing, enum, numeric, and currency errors before mutation", async () => {
    const location = await createLocation("PREVIEW");
    await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-EXISTING`,
        description: "Existing item",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: location.id
      }
    });

    const preview = await previewItemCsvImport([
      "sku,description,category,unit,reorderPoint,targetStock,leadTimeDays,lifecycleStatus,costCurrency",
      `${TEST_PREFIX}-EXISTING,Duplicate existing,COMPONENT,EACH,0,0,0,ACTIVE,USD`,
      `${TEST_PREFIX}-DUP,First duplicate,COMPONENT,EACH,0,0,0,ACTIVE,USD`,
      `${TEST_PREFIX}-DUP,Second duplicate,COMPONENT,EACH,0,0,0,ACTIVE,USD`,
      `${TEST_PREFIX}-BAD,Invalid enums,BAD,EACH,-1,0,0,ACTIVE,USDX`
    ].join("\n"));

    expect(preview.valid).toBe(false);
    expect(preview.rows).toEqual([]);
    expect(preview.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      expect.stringMatching(/already exists/i),
      expect.stringMatching(/duplicate sku/i),
      expect.stringMatching(/category/i),
      expect.stringMatching(/reorderPoint/i),
      expect.stringMatching(/currency/i)
    ]));
  });

  it("validates the entire CSV before creating any items", async () => {
    const location = await createLocation("INVALID-NO-MUTATION");

    const result = await importItemsFromCsv({
      csv: [
        "sku,description,category,unit,reorderPoint,targetStock,leadTimeDays,lifecycleStatus,costCurrency",
        `${TEST_PREFIX}-WOULD-CREATE,Would create,COMPONENT,EACH,1,2,3,ACTIVE,USD`,
        `${TEST_PREFIX}-INVALID,Invalid negative target,COMPONENT,EACH,1,-2,3,ACTIVE,USD`
      ].join("\n"),
      storageLocationId: location.id,
      actorId: `${TEST_PREFIX}-actor-invalid`
    });

    expect(result.valid).toBe(false);
    expect(result.createdCount).toBe(0);
    await expect(prisma.item.count({ where: { sku: { startsWith: TEST_PREFIX } } })).resolves.toBe(0);
  });

  it("creates valid CSV items in one transaction and audits each creation", async () => {
    const location = await createLocation("VALID");

    const result = await importItemsFromCsv({
      csv: [
        "sku,description,category,unit,reorderPoint,targetStock,leadTimeDays,lifecycleStatus,manufacturerPartNo,supplierSku,estimatedUnitCost,costCurrency,costConfidence,costSourceRef",
        `${TEST_PREFIX}-VALID-1,Valid one,COMPONENT,EACH,1,10,7,ACTIVE,MPN-1,SUP-1,1.11,USD,CONFIRMED,Quote 1`,
        `${TEST_PREFIX}-VALID-2,Valid two,CONSUMABLE,METER,2,20,14,NRND,,SUP-2,,CAD,UNKNOWN,`
      ].join("\n"),
      storageLocationId: location.id,
      actorId: `${TEST_PREFIX}-actor-valid`
    });

    expect(result.valid).toBe(true);
    expect(result.createdCount).toBe(2);

    const created = await prisma.item.findMany({
      where: { sku: { in: [`${TEST_PREFIX}-VALID-1`, `${TEST_PREFIX}-VALID-2`] } },
      orderBy: { sku: "asc" }
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      sku: `${TEST_PREFIX}-VALID-1`,
      manufacturerPartNo: "MPN-1",
      supplierSku: "SUP-1",
      reorderPoint: 1,
      targetStock: 10,
      leadTimeDays: 7,
      costCurrency: "USD"
    });

    await expect(prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-actor-valid`, action: "IMPORT_ITEM_CSV_CREATE_ITEM" }
    })).resolves.toBe(2);
  });
});
