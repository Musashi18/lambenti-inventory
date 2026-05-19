import { PrismaClient, ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const supplier = await prisma.supplier.upsert({
    where: { name: "Luma Components" },
    update: {},
    create: {
      name: "Luma Components",
      moq: 50,
      leadTimeDays: 10,
      shippingCost: 24.5,
      reliabilityScore: 94.5,
      productPageUrl: "https://supplier.example/luma"
    }
  });

  const arc = await prisma.supplier.upsert({
    where: { name: "Arc Circuit Supply" },
    update: {},
    create: {
      name: "Arc Circuit Supply",
      moq: 25,
      leadTimeDays: 21,
      shippingCost: 38,
      reliabilityScore: 91.2,
      productPageUrl: "https://supplier.example/arc"
    }
  });

  const led = await prisma.item.upsert({
    where: { sku: "LED-STRIP-2700K" },
    update: {},
    create: {
      sku: "LED-STRIP-2700K",
      manufacturerPartNo: "LMB-LED-2700",
      supplierSku: "LUMA-2700",
      description: "Warm white LED strip",
      category: ItemCategory.COMPONENT,
      unit: Unit.METER,
      reorderPoint: 30,
      targetStock: 120,
      leadTimeDays: 10,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocation: "Studio A-01",
      preferredSupplierId: supplier.id
    }
  });

  const pcb = await prisma.item.upsert({
    where: { sku: "PCB-CONTROL-001" },
    update: {},
    create: {
      sku: "PCB-CONTROL-001",
      manufacturerPartNo: "LMB-PCB-CONTROL",
      supplierSku: "ARC-CTRL-001",
      description: "Main control PCB",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 20,
      targetStock: 80,
      leadTimeDays: 21,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocation: "Workshop B-02",
      preferredSupplierId: arc.id
    }
  });

  const finished = await prisma.item.upsert({
    where: { sku: "LAMBENTI-BASE-001" },
    update: {},
    create: {
      sku: "LAMBENTI-BASE-001",
      description: "Finished Lambenti lighting base",
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.EACH,
      reorderPoint: 5,
      targetStock: 20,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocation: "Finished Goods"
    }
  });

  await prisma.supplierOffer.upsert({
    where: { itemId_supplierId: { itemId: led.id, supplierId: supplier.id } },
    update: {},
    create: {
      itemId: led.id,
      supplierId: supplier.id,
      supplierSku: "LUMA-2700",
      productPageUrl: "https://supplier.example/luma/2700",
      leadTimeDays: 10,
      moq: 50,
      pricingTiers: [
        { minQty: 50, unitPrice: 3.2 },
        { minQty: 100, unitPrice: 2.95 }
      ],
      currency: "USD"
    }
  });

  const lot = await prisma.stockLot.upsert({
    where: { itemId_lotCode: { itemId: led.id, lotCode: "LOT-LED-001" } },
    update: {},
    create: {
      itemId: led.id,
      lotCode: "LOT-LED-001",
      receivedAt: new Date("2026-05-01T00:00:00.000Z"),
      unitCost: 3.2
    }
  });

  const movementCount = await prisma.stockMovement.count();
  if (movementCount === 0) {
    await prisma.stockMovement.createMany({
      data: [
        {
          itemId: led.id,
          stockLotId: lot.id,
          movementType: MovementType.RECEIVE,
          quantity: 60,
          reason: "Initial seed receipt",
          actorType: "SYSTEM",
          actorId: "seed"
        },
        {
          itemId: led.id,
          stockLotId: lot.id,
          movementType: MovementType.CONSUME,
          quantity: 18,
          reason: "Prototype builds",
          actorType: "SYSTEM",
          actorId: "seed"
        }
      ]
    });
  }

  const existingBom = await prisma.bOM.findFirst({
    where: { parentItemId: finished.id, version: "v1" }
  });

  if (!existingBom) {
    await prisma.bOM.create({
      data: {
        parentItemId: finished.id,
        version: "v1",
        lines: {
          create: [
            { componentItemId: led.id, quantity: 2 },
            { componentItemId: pcb.id, quantity: 1 }
          ]
        }
      }
    });
  }

  await prisma.buildReservation.upsert({
    where: { id: "build-launch-batch" },
    update: {},
    create: {
      id: "build-launch-batch",
      itemId: led.id,
      buildName: "Launch Batch",
      quantity: 40,
      dueDate: new Date("2026-06-15T00:00:00.000Z")
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

