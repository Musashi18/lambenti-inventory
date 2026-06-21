import { ItemCategory, LifecycleStatus, MovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { createStockMovementInTransaction } from "@/modules/inventory/service";

type BomActorInput = { actorId: string; actorType?: "USER" | "AGENT" };

export async function getBomExplosion() {
  return prisma.bOM.findMany({
    where: { active: true, parentItem: { lifecycleStatus: { not: "OBSOLETE" } } },
    include: {
      parentItem: true,
      lines: {
        include: {
          componentItem: true
        },
        orderBy: { id: "asc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function getBomWorkspace() {
  const [boms, activeItems, finishedUnitItems] = await Promise.all([
    getBomExplosion(),
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      orderBy: { sku: "asc" }
    }),
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" }, category: ItemCategory.FINISHED_GOOD },
      orderBy: { sku: "asc" }
    })
  ]);

  return { boms, activeItems, finishedUnitItems };
}

export async function createBomSection(input: { parentItemId: string } & BomActorInput) {
  const parentItem = await getActiveItemOrThrow(input.parentItemId, "Finished unit item");
  if (parentItem.category !== ItemCategory.FINISHED_GOOD) {
    throw new Error("Finished unit item must be an active finished-good item from the item master.");
  }
  const version = await nextBomVersion(input.parentItemId);

  const bom = await prisma.bOM.create({
    data: {
      parentItemId: parentItem.id,
      version
    },
    include: {
      parentItem: true,
      lines: { include: { componentItem: true }, orderBy: { id: "asc" } }
    }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "CREATE_BOM_SECTION",
    entityType: "BOM",
    entityId: bom.id,
    payload: {
      parentItemId: parentItem.id,
      parentSku: parentItem.sku,
      version: bom.version
    }
  });

  return bom;
}

export async function addBomLine(input: { bomId: string; componentItemId: string; quantity: number } & BomActorInput) {
  assertPositiveBomQuantity(input.quantity);
  const bom = await getActiveBomOrThrow(input.bomId);
  const componentItem = await getActiveItemOrThrow(input.componentItemId, "Component item");
  if (componentItem.id === bom.parentItemId) {
    throw new Error("A finished unit cannot use itself as a BOM component.");
  }

  const line = await prisma.bOMLine.create({
    data: {
      bomId: bom.id,
      componentItemId: componentItem.id,
      quantity: input.quantity
    },
    include: { bom: { include: { parentItem: true } }, componentItem: true }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "ADD_BOM_LINE",
    entityType: "BOMLine",
    entityId: line.id,
    payload: {
      bomId: line.bomId,
      parentSku: line.bom.parentItem.sku,
      componentSku: line.componentItem.sku,
      quantity: toQuantityNumber(line.quantity)
    }
  });

  return line;
}

export async function updateBomLine(input: { lineId: string; componentItemId: string; quantity: number } & BomActorInput) {
  assertPositiveBomQuantity(input.quantity);

  const existing = await prisma.bOMLine.findUnique({
    where: { id: input.lineId },
    include: { bom: { include: { parentItem: true } }, componentItem: true }
  });
  if (!existing || !existing.bom.active || existing.bom.parentItem.lifecycleStatus === "OBSOLETE") {
    throw new Error("Active BOM line does not exist.");
  }

  const componentItem = await getActiveItemOrThrow(input.componentItemId, "Component item");
  if (componentItem.id === existing.bom.parentItemId) {
    throw new Error("A finished unit cannot use itself as a BOM component.");
  }

  const line = await prisma.bOMLine.update({
    where: { id: input.lineId },
    data: { componentItemId: componentItem.id, quantity: input.quantity },
    include: { bom: { include: { parentItem: true } }, componentItem: true }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "UPDATE_BOM_LINE_QUANTITY",
    entityType: "BOMLine",
    entityId: line.id,
    payload: {
      bomId: line.bomId,
      parentSku: line.bom.parentItem.sku,
      previousComponentSku: existing.componentItem.sku,
      componentSku: line.componentItem.sku,
      previousQuantity: toQuantityNumber(existing.quantity),
      quantity: toQuantityNumber(line.quantity)
    }
  });

  return line;
}

export async function updateBomLineQuantity(input: { lineId: string; quantity: number } & BomActorInput) {
  const existing = await prisma.bOMLine.findUnique({ where: { id: input.lineId }, select: { componentItemId: true } });
  if (!existing) throw new Error("Active BOM line does not exist.");
  return updateBomLine({ ...input, componentItemId: existing.componentItemId });
}

export async function removeBomLine(input: { lineId: string } & BomActorInput) {
  const existing = await prisma.bOMLine.findUnique({
    where: { id: input.lineId },
    include: { bom: { include: { parentItem: true } }, componentItem: true }
  });
  if (!existing) throw new Error("BOM line does not exist.");

  await prisma.bOMLine.delete({ where: { id: input.lineId } });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "REMOVE_BOM_LINE",
    entityType: "BOMLine",
    entityId: existing.id,
    payload: {
      bomId: existing.bomId,
      parentSku: existing.bom.parentItem.sku,
      componentSku: existing.componentItem.sku,
      quantity: toQuantityNumber(existing.quantity),
      note: "Removed BOM configuration row only. Inventory movement history is unchanged."
    }
  });

  return existing;
}

export async function consumeBomBuild(input: { bomId: string; buildQuantity: number; reference?: string; reason?: string; actorId: string; actorType?: "USER" | "AGENT" }) {
  if (!Number.isInteger(input.buildQuantity) || input.buildQuantity <= 0) {
    throw new Error("Build quantity must be a positive whole number.");
  }

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const bom = await tx.bOM.findUnique({
      where: { id: input.bomId },
      include: {
        parentItem: true,
        lines: {
          include: { componentItem: true }
        }
      }
    });
    if (!bom || !bom.active || bom.parentItem.lifecycleStatus === "OBSOLETE") throw new Error("Active BOM does not exist.");
    if (bom.lines.length === 0) throw new Error("Cannot consume inventory from a BOM with no component lines.");
    assertNoObsoleteBomComponentLines(bom.lines);

    const movements = [];
    for (const line of bom.lines) {
      const quantityPerUnit = toQuantityNumber(line.quantity);
      const quantity = quantityPerUnit * input.buildQuantity;
      movements.push(await createStockMovementInTransaction(tx, {
        itemId: line.componentItemId,
        movementType: MovementType.CONSUME,
        quantity,
        reason: input.reason?.trim() || `BOM ${bom.parentItem.sku} ${bom.version}: consumed ${formatQuantity(quantityPerUnit)} per unit × ${input.buildQuantity} build(s)`,
        reference: input.reference?.trim() || `BOM:${bom.id}`,
        actorType: input.actorType ?? "USER",
        actorId: input.actorId
      }));
    }

    await writeAuditLog({
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      action: "CONSUME_BOM_BUILD",
      entityType: "BOM",
      entityId: bom.id,
      payload: {
        parentSku: bom.parentItem.sku,
        version: bom.version,
        buildQuantity: input.buildQuantity,
        movementIds: movements.map((movement) => movement.id)
      }
    }, tx);

    return { bom, movements };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function consumeBomBuildForParentItem(input: { parentItemId: string; buildQuantity: number; reference?: string; reason?: string; actorId: string; actorType?: "USER" | "AGENT" }) {
  const bom = await prisma.bOM.findFirst({
    where: { parentItemId: input.parentItemId, active: true, parentItem: { lifecycleStatus: { not: "OBSOLETE" } } },
    orderBy: { createdAt: "desc" }
  });
  if (!bom) {
    throw new Error("No active BOM exists for the selected item. Add BOM component quantities before recording a build movement.");
  }
  return consumeBomBuild({
    bomId: bom.id,
    buildQuantity: input.buildQuantity,
    reference: input.reference,
    reason: input.reason,
    actorId: input.actorId,
    actorType: input.actorType
  });
}

function assertPositiveBomQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("BOM quantity per unit must be a positive number.");
  }
}

function toQuantityNumber(quantity: Prisma.Decimal | number) {
  return Number(quantity);
}

function formatQuantity(quantity: number) {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toString();
}

function assertNoObsoleteBomComponentLines(lines: { componentItem: { sku: string; lifecycleStatus: LifecycleStatus } }[]) {
  const obsoleteSkus = lines
    .filter((line) => line.componentItem.lifecycleStatus === LifecycleStatus.OBSOLETE)
    .map((line) => line.componentItem.sku);
  if (obsoleteSkus.length > 0) {
    throw new Error(`Cannot record build while obsolete BOM component lines remain: ${obsoleteSkus.join(", ")}. Correct the BOM before consuming inventory.`);
  }
}

async function getActiveBomOrThrow(bomId: string) {
  const bom = await prisma.bOM.findUnique({ where: { id: bomId }, include: { parentItem: true } });
  if (!bom || !bom.active || bom.parentItem.lifecycleStatus === "OBSOLETE") {
    throw new Error("Active BOM does not exist.");
  }
  return bom;
}

async function getActiveItemOrThrow(itemId: string, label: string) {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item || item.lifecycleStatus === "OBSOLETE") {
    throw new Error(`${label} must be an active item from the item master.`);
  }
  return item;
}

async function nextBomVersion(parentItemId: string) {
  const existing = await prisma.bOM.findMany({ where: { parentItemId }, select: { version: true } });
  const maxNumericVersion = existing.reduce((max, bom) => {
    const numeric = bom.version.match(/^v(\d+)$/i)?.[1];
    return numeric ? Math.max(max, Number(numeric)) : max;
  }, 0);
  return `v${maxNumericVersion + 1}`;
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 16): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableSerializableConflict(error) || attempt === maxAttempts) {
        throw error;
      }
      await delayBeforeRetry(attempt);
    }
  }

  throw lastError;
}

function delayBeforeRetry(attempt: number) {
  const delayMs = Math.min(15 * 2 ** (attempt - 1), 500);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
