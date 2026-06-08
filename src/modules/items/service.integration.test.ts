import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { archiveItem, getItems, unarchiveItem } from "./service";

const TEST_PREFIX = "TEST-ITEM-ARCHIVE";

async function cleanup() {
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length > 0) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createItem(suffix: string, lifecycleStatus: LifecycleStatus = LifecycleStatus.ACTIVE) {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} ${suffix}` } });
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}`,
      description: `${TEST_PREFIX} ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 1,
      lifecycleStatus,
      storageLocationId: location.id
    }
  });
}

describe("item archive visibility", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("keeps obsolete items out of the active list while exposing them in the archived list", async () => {
    const active = await createItem("ACTIVE");
    const archived = await createItem("ARCHIVED", LifecycleStatus.OBSOLETE);

    const activeList = await getItems();
    const archivedList = await getItems({ archivedOnly: true });

    expect(activeList.some((item) => item.id === active.id)).toBe(true);
    expect(activeList.some((item) => item.id === archived.id)).toBe(false);
    expect(archivedList.some((item) => item.id === archived.id)).toBe(true);
    expect(archivedList.some((item) => item.id === active.id)).toBe(false);
  });

  it("archives and unarchives without deleting the item", async () => {
    const item = await createItem("ROUNDTRIP");

    await archiveItem({ id: item.id, actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.item.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ lifecycleStatus: LifecycleStatus.OBSOLETE });

    await unarchiveItem({ id: item.id, actorId: `${TEST_PREFIX}-operator` });
    await expect(prisma.item.findUniqueOrThrow({ where: { id: item.id } })).resolves.toMatchObject({ lifecycleStatus: LifecycleStatus.ACTIVE });
  });
});
