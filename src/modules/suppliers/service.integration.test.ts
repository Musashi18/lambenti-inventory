import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CostConfidence, ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { archiveSupplierProfile, deleteArchivedSupplier, getActiveSupplierOptions, getArchivedSupplierProfiles, getItemSupplierEntries, getUniqueSupplierProfiles, unarchiveSupplierProfile, updateItemSupplierEntry } from "./service";

const TEST_PREFIX = "QA-SUPPLIER-ENTRIES";

async function cleanup() {
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length > 0) {
    await prisma.supplierOffer.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createFixtures() {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-LOC`, name: `${TEST_PREFIX} location` } });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX} Supplier`,
      companyName: `${TEST_PREFIX} Company`,
      contactEmail: "supplier@example.com",
      contactName: "Supplier Contact",
      moq: 10,
      leadTimeDays: 14,
      shippingCost: 5,
      reliabilityScore: 4.5
    }
  });
  const component = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-LED`,
      description: "LED strip",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 1,
      targetStock: 5,
      leadTimeDays: 7,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id,
      supplierSku: "SUP-LED",
      preferredSupplierId: supplier.id,
      estimatedUnitCost: 2.5,
      costCurrency: "USD",
      costConfidence: CostConfidence.QUOTED,
      costSourceRef: "Quote 1"
    }
  });
  const rawMaterial = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-CABLE`,
      description: "Cable",
      category: ItemCategory.RAW_MATERIAL,
      unit: Unit.METER,
      reorderPoint: 1,
      targetStock: 5,
      leadTimeDays: 7,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id,
      estimatedUnitCost: 0.75,
      costCurrency: "USD",
      costConfidence: CostConfidence.ESTIMATED
    }
  });
  await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-OLD`,
      description: "Old item",
      category: ItemCategory.CONSUMABLE,
      unit: Unit.EACH,
      reorderPoint: 1,
      targetStock: 5,
      leadTimeDays: 7,
      lifecycleStatus: LifecycleStatus.OBSOLETE,
      storageLocationId: location.id
    }
  });
  return { supplier, component, rawMaterial };
}

describe("item-derived supplier entries", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("returns every active supplier profile displayed on the suppliers page for item dropdowns", async () => {
    const confirmed = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Confirmed Supplier`,
        confirmedByHuman: true,
        companyName: `${TEST_PREFIX} Confirmed Co`,
        contactEmail: "confirmed@example.com",
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });
    const unconfirmed = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Unconfirmed Supplier`,
        confirmedByHuman: false,
        companyName: `${TEST_PREFIX} Unconfirmed Co`,
        contactEmail: "unconfirmed@example.com",
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });
    await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Archived Supplier`,
        confirmedByHuman: true,
        companyName: `${TEST_PREFIX} Archived Co`,
        contactEmail: "archived@example.com",
        archivedAt: new Date(),
        archivedBy: `${TEST_PREFIX}-setup`,
        archiveReason: "Hidden from active dropdowns",
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });

    const displayedSupplierIds = (await getUniqueSupplierProfiles()).map((profile) => profile.id);
    const options = await getActiveSupplierOptions();
    const optionIds = options.map((option) => option.id);
    const optionNames = options.map((option) => option.name);

    expect(displayedSupplierIds).toEqual(expect.arrayContaining([confirmed.id, unconfirmed.id]));
    expect(optionIds).toEqual(expect.arrayContaining([confirmed.id, unconfirmed.id]));
    expect(optionNames).toEqual(expect.arrayContaining([`${TEST_PREFIX} Confirmed Co`, `${TEST_PREFIX} Unconfirmed Co`]));
    expect(optionNames).not.toContain(`${TEST_PREFIX} Archived Co`);
  });

  it("creates supplier rows from every active item type even when no SupplierOffer exists", async () => {
    const { component, rawMaterial, supplier } = await createFixtures();

    const entries = await getItemSupplierEntries();

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemId: component.id,
        sku: component.sku,
        cleanItemType: "Component",
        supplierSku: "SUP-LED",
        supplierId: supplier.id,
        supplierName: supplier.name,
        unitPriceUsd: 2.5
      }),
      expect.objectContaining({
        itemId: rawMaterial.id,
        sku: rawMaterial.sku,
        cleanItemType: "Raw Material",
        supplierId: "",
        supplierName: "Unassigned",
        unitPriceUsd: 0.75
      })
    ]));
    expect(entries.some((entry) => entry.sku.endsWith("-OLD"))).toBe(false);
  });

  it("updates the editable supplier fields on the item record and audits the change", async () => {
    const { rawMaterial, supplier } = await createFixtures();

    await updateItemSupplierEntry({
      itemId: rawMaterial.id,
      preferredSupplierId: supplier.id,
      supplierSku: "SUP-CABLE",
      estimatedUnitCost: 1.25,
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Supplier row edit",
      actorId: `${TEST_PREFIX}-actor`
    });

    await expect(prisma.item.findUniqueOrThrow({ where: { id: rawMaterial.id } })).resolves.toMatchObject({
      preferredSupplierId: supplier.id,
      supplierSku: "SUP-CABLE",
      costCurrency: "USD",
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Supplier row edit"
    });
    const updated = await prisma.item.findUniqueOrThrow({ where: { id: rawMaterial.id } });
    expect(updated.estimatedUnitCost?.toNumber()).toBe(1.25);

    await expect(prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-actor`, action: "UPDATE_ITEM_SUPPLIER_ENTRY", entityId: rawMaterial.id }
    })).resolves.toBe(1);
  });

  it("creates and assigns a custom supplier from item sourcing rows", async () => {
    const { rawMaterial } = await createFixtures();
    const customSupplierName = `${TEST_PREFIX} Custom Row Supplier`;

    await updateItemSupplierEntry({
      itemId: rawMaterial.id,
      preferredSupplierId: "",
      customSupplierName,
      supplierSku: "CUSTOM-ROW-SKU",
      estimatedUnitCost: 1.5,
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Custom supplier row",
      actorId: `${TEST_PREFIX}-custom-actor`
    });

    const updated = await prisma.item.findUniqueOrThrow({
      where: { id: rawMaterial.id },
      include: { preferredSupplier: true }
    });
    expect(updated.preferredSupplier).toMatchObject({
      name: customSupplierName,
      companyName: customSupplierName,
      confirmedByHuman: true
    });
    expect(updated.supplierSku).toBe("CUSTOM-ROW-SKU");
    await expect(prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-custom-actor`, action: "CREATE_CUSTOM_SUPPLIER", entityId: updated.preferredSupplierId ?? undefined }
    })).resolves.toBe(1);
  });

  it("archives supplier profiles so they disappear from active lists and confirmed dropdowns", async () => {
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Archive Me`,
        confirmedByHuman: true,
        companyName: `${TEST_PREFIX} Archive Me Co`,
        contactEmail: "archive-me@example.com",
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });

    await archiveSupplierProfile({
      supplierId: supplier.id,
      actorId: `${TEST_PREFIX}-archive-actor`,
      reason: "No longer relevant"
    });

    await expect(prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).resolves.toMatchObject({
      archivedBy: `${TEST_PREFIX}-archive-actor`,
      archiveReason: "No longer relevant"
    });
    const activeProfileIds = (await getUniqueSupplierProfiles()).map((profile) => profile.id);
    const optionIds = (await getActiveSupplierOptions()).map((option) => option.id);
    expect(activeProfileIds).not.toContain(supplier.id);
    expect(optionIds).not.toContain(supplier.id);
    await expect(prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-archive-actor`, action: "ARCHIVE_SUPPLIER", entityId: supplier.id }
    })).resolves.toBe(1);
  });

  it("unarchives supplier profiles back into active lists and dropdown eligibility", async () => {
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Unarchive Me`,
        confirmedByHuman: true,
        companyName: `${TEST_PREFIX} Unarchive Me Co`,
        contactEmail: "unarchive-me@example.com",
        archivedAt: new Date(),
        archivedBy: `${TEST_PREFIX}-setup`,
        archiveReason: "Temporary archive",
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });

    await unarchiveSupplierProfile({
      supplierId: supplier.id,
      actorId: `${TEST_PREFIX}-unarchive-actor`
    });

    const activeProfileIds = (await getUniqueSupplierProfiles()).map((profile) => profile.id);
    const archivedProfileIds = (await getArchivedSupplierProfiles()).map((profile) => profile.id);
    const optionIds = (await getActiveSupplierOptions()).map((option) => option.id);
    expect(activeProfileIds).toContain(supplier.id);
    expect(archivedProfileIds).not.toContain(supplier.id);
    expect(optionIds).toContain(supplier.id);
    await expect(prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-unarchive-actor`, action: "UNARCHIVE_SUPPLIER", entityId: supplier.id }
    })).resolves.toBe(1);
  });

  it("only hard-deletes suppliers after they are archived", async () => {
    const active = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Active Delete Blocked`,
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });
    const archived = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Archived Delete Allowed`,
        archivedAt: new Date(),
        archivedBy: `${TEST_PREFIX}-setup`,
        archiveReason: "Cleanup",
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });

    await expect(deleteArchivedSupplier({
      supplierId: active.id,
      actorId: `${TEST_PREFIX}-delete-actor`
    })).rejects.toThrow("Archive the supplier before deleting it.");

    await deleteArchivedSupplier({
      supplierId: archived.id,
      actorId: `${TEST_PREFIX}-delete-actor`
    });

    await expect(prisma.supplier.findUnique({ where: { id: archived.id } })).resolves.toBeNull();
    await expect(prisma.auditLog.count({
      where: { actorId: `${TEST_PREFIX}-delete-actor`, action: "DELETE_ARCHIVED_SUPPLIER", entityId: archived.id }
    })).resolves.toBe(1);
  });
});
