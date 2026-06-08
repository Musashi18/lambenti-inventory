import { CostConfidence, ItemCategory, LifecycleStatus, MovementType, PrismaClient, Unit } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const studio = await prisma.storageLocation.upsert({
    where: { code: "STUDIO-A-01" },
    update: {},
    create: {
      code: "STUDIO-A-01",
      name: "Studio shelf / parts bin A-01",
      description: "Default trusted location for Lambenti Phase I electronics and small parts."
    }
  });

  const workshop = await prisma.storageLocation.upsert({
    where: { code: "WORKSHOP-B-02" },
    update: {},
    create: {
      code: "WORKSHOP-B-02",
      name: "Workshop build bin B-02",
      description: "Assembly-stage parts and prototype build materials."
    }
  });

  const finishedGoods = await prisma.storageLocation.upsert({
    where: { code: "FINISHED-GOODS" },
    update: {},
    create: {
      code: "FINISHED-GOODS",
      name: "Finished goods staging",
      description: "Completed or packaged Lambenti units awaiting QA/ship."
    }
  });

  const chinaSupplier = await prisma.supplier.upsert({
    where: { name: "China DDP Supplier / Confirmed Orders" },
    update: { confirmedByHuman: true },
    create: {
      name: "China DDP Supplier / Confirmed Orders",
      confirmedByHuman: true,
      moq: 100,
      leadTimeDays: 21,
      shippingCost: 0,
      reliabilityScore: 80,
      productPageUrl: null
    }
  });

  const jlcpcb = await prisma.supplier.upsert({
    where: { name: "JLCPCB" },
    update: { confirmedByHuman: true },
    create: {
      name: "JLCPCB",
      confirmedByHuman: true,
      moq: 5,
      leadTimeDays: 10,
      shippingCost: 0,
      reliabilityScore: 85,
      productPageUrl: "https://jlcpcb.com"
    }
  });

  const led3000 = await prisma.item.upsert({
    where: { sku: "LED-COB-12V-3000K" },
    update: {},
    create: {
      sku: "LED-COB-12V-3000K",
      description: "12 V COB LED strip, warm white 3000K",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 20,
      targetStock: 100,
      leadTimeDays: 21,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: studio.id,
      preferredSupplierId: chinaSupplier.id,
      estimatedUnitCost: 0.86,
      costCurrency: "USD",
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Known order anchor: COB strips 3000K/6500K 100 each around USD 171 total"
    }
  });

  await prisma.item.upsert({
    where: { sku: "LED-COB-12V-6500K" },
    update: {},
    create: {
      sku: "LED-COB-12V-6500K",
      description: "12 V COB LED strip, cool white 6500K",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 20,
      targetStock: 100,
      leadTimeDays: 21,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: studio.id,
      preferredSupplierId: chinaSupplier.id,
      estimatedUnitCost: 0.86,
      costCurrency: "USD",
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Known order anchor: COB strips 3000K/6500K 100 each around USD 171 total"
    }
  });

  const powerAdapter = await prisma.item.upsert({
    where: { sku: "PSU-12V-GS-UL" },
    update: {},
    create: {
      sku: "PSU-12V-GS-UL",
      description: "12 V GS/UL certified wall power adapter",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 25,
      targetStock: 200,
      leadTimeDays: 30,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: studio.id,
      preferredSupplierId: chinaSupplier.id,
      estimatedUnitCost: 1.93,
      costCurrency: "USD",
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Known order anchor: 200 GS/UL 12V power adapters around USD 386 DDP Canada"
    }
  });

  const cable = await prisma.item.upsert({
    where: { sku: "CABLE-UL2464-2C-1P5M" },
    update: {},
    create: {
      sku: "CABLE-UL2464-2C-1P5M",
      description: "Custom UL2464 24 AWG 2C 1.5 m cable with Micro-Fit-compatible ends",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 20,
      targetStock: 100,
      leadTimeDays: 25,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: studio.id,
      preferredSupplierId: chinaSupplier.id,
      estimatedUnitCost: 1.76,
      costCurrency: "USD",
      costConfidence: CostConfidence.CONFIRMED,
      costSourceRef: "Known order anchor: 100 custom cables around USD 176.39"
    }
  });

  const pcb = await prisma.item.upsert({
    where: { sku: "PCB-MAIN-REV-B" },
    update: {},
    create: {
      sku: "PCB-MAIN-REV-B",
      description: "Lambenti main control PCB Rev B / ATmega328PB + triple MMC5603NJ layout",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 10,
      targetStock: 50,
      leadTimeDays: 14,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: workshop.id,
      preferredSupplierId: jlcpcb.id,
      costCurrency: "USD",
      costConfidence: CostConfidence.UNKNOWN,
      costSourceRef: "JLCPCB order history should be entered before production use"
    }
  });

  const finished = await prisma.item.upsert({
    where: { sku: "LAMBENTI-BASIC-UNIT" },
    update: {},
    create: {
      sku: "LAMBENTI-BASIC-UNIT",
      description: "Finished Lambenti Basic unit, single-channel white LED version",
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.EACH,
      reorderPoint: 5,
      targetStock: 50,
      leadTimeDays: 0,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: finishedGoods.id,
      costCurrency: "USD",
      costConfidence: CostConfidence.ESTIMATED,
      costSourceRef: "Derived from BOM once real received costs are complete"
    }
  });

  await prisma.supplierOffer.upsert({
    where: { itemId_supplierId: { itemId: cable.id, supplierId: chinaSupplier.id } },
    update: {},
    create: {
      itemId: cable.id,
      supplierId: chinaSupplier.id,
      supplierSku: "CUSTOM-UL2464-2C-1P5M",
      productPageUrl: null,
      leadTimeDays: 25,
      moq: 100,
      pricingTiers: [{ minQty: 100, unitPrice: 1.76 }],
      currency: "USD"
    }
  });

  const ledLot = await prisma.stockLot.upsert({
    where: { itemId_lotCode: { itemId: led3000.id, lotCode: "LOT-LED-3000K-INITIAL" } },
    update: {},
    create: {
      itemId: led3000.id,
      lotCode: "LOT-LED-3000K-INITIAL",
      receivedAt: new Date("2026-05-01T00:00:00.000Z"),
      unitCost: 0.86
    }
  });

  const cableLot = await prisma.stockLot.upsert({
    where: { itemId_lotCode: { itemId: cable.id, lotCode: "LOT-CABLE-INITIAL" } },
    update: {},
    create: {
      itemId: cable.id,
      lotCode: "LOT-CABLE-INITIAL",
      receivedAt: new Date("2026-05-01T00:00:00.000Z"),
      unitCost: 1.76
    }
  });

  const movementCount = await prisma.stockMovement.count();
  if (movementCount === 0) {
    await prisma.stockMovement.createMany({
      data: [
        {
          itemId: led3000.id,
          stockLotId: ledLot.id,
          movementType: MovementType.RECEIVE,
          quantity: 100,
          reason: "Initial confirmed LED strip receipt",
          reference: "PO-SEED-LED-3000K",
          actorType: "SYSTEM",
          actorId: "seed"
        },
        {
          itemId: cable.id,
          stockLotId: cableLot.id,
          movementType: MovementType.RECEIVE,
          quantity: 100,
          reason: "Initial confirmed custom cable receipt",
          reference: "PO-SEED-CABLES",
          actorType: "SYSTEM",
          actorId: "seed"
        },
        {
          itemId: led3000.id,
          stockLotId: ledLot.id,
          movementType: MovementType.RESERVE,
          quantity: 40,
          reason: "Reserve LEDs for Phase I launch batch",
          reference: "build-phase-i",
          actorType: "SYSTEM",
          actorId: "seed"
        }
      ]
    });
  }

  const existingBom = await prisma.bOM.findFirst({
    where: { parentItemId: finished.id, version: "basic-v1" }
  });

  if (!existingBom) {
    await prisma.bOM.create({
      data: {
        parentItemId: finished.id,
        version: "basic-v1",
        lines: {
          create: [
            { componentItemId: led3000.id, quantity: 1 },
            { componentItemId: pcb.id, quantity: 1 },
            { componentItemId: cable.id, quantity: 1 },
            { componentItemId: powerAdapter.id, quantity: 1 }
          ]
        }
      }
    });
  }

  await prisma.buildReservation.upsert({
    where: { id: "build-phase-i" },
    update: {},
    create: {
      id: "build-phase-i",
      itemId: led3000.id,
      buildName: "Phase I Launch Batch",
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
