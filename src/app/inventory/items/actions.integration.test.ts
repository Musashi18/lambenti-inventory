import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

import {
  archiveItemAction,
  archiveItemFormAction,
  createItemFormAction,
  importItemsCsvFormAction,
  unarchiveItemFormAction,
  updateItemFormAction
} from "./actions";

const TEST_PREFIX = "TEST-ITEM-ACTION";
const EMPTY_STATE = { ok: false, message: "" };

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

  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
}

async function createLocation(suffix: string) {
  return prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Item action test ${suffix}` }
  });
}

function itemForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    sku: `${TEST_PREFIX}-ITEM`,
    description: "Action test item",
    manufacturerPartNo: "",
    supplierSku: "",
    category: ItemCategory.COMPONENT,
    unit: Unit.EACH,
    reorderPoint: "1",
    targetStock: "10",
    leadTimeDays: "7",
    preferredSupplierId: "",
    lifecycleStatus: LifecycleStatus.ACTIVE,
    estimatedUnitCost: "1.23",
    costCurrency: "USD",
    costConfidence: "CONFIRMED",
    costSourceRef: "Test quote",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

describe("inventory item server-action contracts", () => {
  beforeEach(cleanupTestData);
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(cleanupTestData);

  it("rejects item mutations from authenticated viewers before writing catalog data", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "VIEWER");
    const location = await createLocation("VIEWER-BLOCKED");
    const form = itemForm({
      sku: `${TEST_PREFIX}-VIEWER-BLOCKED`,
      storageLocationId: location.id
    });

    const result = await createItemFormAction(EMPTY_STATE, form);

    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/item:edit/i);
    await expect(prisma.item.count({ where: { sku: `${TEST_PREFIX}-VIEWER-BLOCKED` } })).resolves.toBe(0);
  });

  it("creates items with inline success state and keeps duplicate SKU errors user-facing", async () => {
    const location = await createLocation("CREATE");
    const firstForm = itemForm({
      sku: `${TEST_PREFIX}-CREATE`,
      storageLocationId: location.id
    });

    const first = await createItemFormAction(EMPTY_STATE, firstForm);
    expect(first).toMatchObject({ ok: true });
    expect(first.message).toMatch(/created item/i);

    const duplicate = await createItemFormAction(EMPTY_STATE, firstForm);
    expect(duplicate).toMatchObject({ ok: false });
    expect(duplicate.message).toMatch(/sku already exists/i);
  });

  it("creates and assigns a custom preferred supplier from item forms", async () => {
    const location = await createLocation("CUSTOM-SUPPLIER");
    const customSupplierName = `${TEST_PREFIX} Custom Supplier`;
    const form = itemForm({
      sku: `${TEST_PREFIX}-CUSTOM-SUPPLIER`,
      storageLocationId: location.id,
      preferredSupplierId: "",
      customSupplierName
    });

    const result = await createItemFormAction(EMPTY_STATE, form);

    expect(result).toMatchObject({ ok: true });
    const item = await prisma.item.findUniqueOrThrow({
      where: { sku: `${TEST_PREFIX}-CUSTOM-SUPPLIER` },
      include: { preferredSupplier: true }
    });
    expect(item.preferredSupplier).toMatchObject({
      name: customSupplierName,
      companyName: customSupplierName,
      confirmedByHuman: true
    });
  });

  it("uses the first available storage location when the hidden location field is missing", async () => {
    const location = await createLocation("DEFAULT");
    const form = itemForm({ sku: `${TEST_PREFIX}-DEFAULT` });
    form.delete("storageLocationId");

    const result = await createItemFormAction(EMPTY_STATE, form);

    expect(result).toMatchObject({ ok: true });
    await expect(prisma.item.findUniqueOrThrow({ where: { sku: `${TEST_PREFIX}-DEFAULT` } })).resolves.toMatchObject({
      storageLocationId: location.id
    });
  });

  it("updates item fields with inline success state", async () => {
    const location = await createLocation("UPDATE");
    const item = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-UPDATE`,
        description: "Before update",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 1,
        targetStock: 2,
        leadTimeDays: 3,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: location.id
      }
    });

    const form = itemForm({
      itemId: item.id,
      sku: `${TEST_PREFIX}-UPDATE-RENAMED`,
      description: "After update",
      reorderPoint: "5",
      targetStock: "15",
      leadTimeDays: "9",
      estimatedUnitCost: "2.34",
      costConfidence: "QUOTED",
      costSourceRef: "Updated quote"
    });

    const result = await updateItemFormAction(EMPTY_STATE, form);
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toMatch(/updated item/i);

    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated).toMatchObject({
      sku: `${TEST_PREFIX}-UPDATE-RENAMED`,
      description: "After update",
      reorderPoint: 5,
      targetStock: 15,
      leadTimeDays: 9,
      costConfidence: "QUOTED"
    });
  });

  it("imports item CSV through the server-action contract with inline status", async () => {
    const location = await createLocation("IMPORT-ACTION");
    const form = new FormData();
    form.set("storageLocationId", location.id);
    form.set("csv", [
      "sku,description,category,unit,reorderPoint,targetStock,leadTimeDays,lifecycleStatus,costCurrency",
      `${TEST_PREFIX}-IMPORT-ACTION,Imported by action,COMPONENT,EACH,1,5,9,ACTIVE,USD`
    ].join("\n"));

    const result = await importItemsCsvFormAction(EMPTY_STATE, form);

    expect(result).toMatchObject({ ok: true });
    expect(result.message).toMatch(/imported 1 item/i);
    await expect(prisma.item.count({ where: { sku: `${TEST_PREFIX}-IMPORT-ACTION` } })).resolves.toBe(1);
  });

  it("archives items with inline success state instead of hard-deleting historical inventory master data", async () => {
    const location = await createLocation("ARCHIVE");
    const item = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-ARCHIVE`,
        description: "Archive target",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: location.id
      }
    });

    const form = new FormData();
    form.set("itemId", item.id);
    const state = await archiveItemFormAction(EMPTY_STATE, form);

    expect(state).toMatchObject({ ok: true });
    expect(state.message).toMatch(/archived item/i);

    const archived = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(archived.lifecycleStatus).toBe(LifecycleStatus.OBSOLETE);

    await expect(prisma.auditLog.count({
      where: { entityId: item.id, action: "ARCHIVE_ITEM" }
    })).resolves.toBe(1);

    await expect(archiveItemAction(form)).resolves.toBeUndefined();
  });

  it("unarchives obsolete items with inline success state and audit provenance", async () => {
    const location = await createLocation("UNARCHIVE");
    const item = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-UNARCHIVE`,
        description: "Unarchive target",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.OBSOLETE,
        storageLocationId: location.id
      }
    });

    const form = new FormData();
    form.set("itemId", item.id);
    const state = await unarchiveItemFormAction(EMPTY_STATE, form);

    expect(state).toMatchObject({ ok: true });
    expect(state.message).toMatch(/unarchived item/i);

    const unarchived = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(unarchived.lifecycleStatus).toBe(LifecycleStatus.ACTIVE);

    await expect(prisma.auditLog.count({
      where: { entityId: item.id, action: "UNARCHIVE_ITEM" }
    })).resolves.toBe(1);
  });
});
