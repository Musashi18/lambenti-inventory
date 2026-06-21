import type { MovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CURRENCY, convertUnitCostToUsd, getLiveUsdConversionRates, roundUnitCost, type CurrencyConversionOptions } from "@/modules/currency";
import { getItemLandedCostIndex, type ItemLandedCostSummary } from "@/modules/accounting/landed-cost";
import type { PricedItemValuationInput } from "./valuation";

export type ResolvedItemUnitCostSource = "ACCOUNTING_LANDED_COST" | "ITEM_UNIT_COST" | "BOM_ROLLUP";

export type ResolvedItemUnitCost = {
  itemId: string;
  sku: string;
  unitCost: number;
  currency: typeof DEFAULT_CURRENCY;
  source: ResolvedItemUnitCostSource;
  sourceLabel: string;
  sourceRefs: string[];
};

type ItemForUnitCost = {
  id: string;
  sku: string;
  description?: string;
  category: string;
  estimatedUnitCost: number | string | { toString(): string } | null;
  costCurrency: string;
  costSourceRef?: string | null;
};

type BomForUnitCost = {
  id?: string;
  parentItemId: string;
  version: string;
  active?: boolean;
  lines: Array<{
    componentItemId: string;
    quantity: number | { toString(): string };
    componentItem?: { sku: string };
  }>;
};

export function resolveItemUnitCostIndex(
  items: ItemForUnitCost[],
  boms: BomForUnitCost[],
  landedCostIndex: Map<string, ItemLandedCostSummary> = new Map(),
  conversionOptions: CurrencyConversionOptions = {}
) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const bomsByParentItemId = new Map<string, BomForUnitCost>();
  for (const bom of boms) {
    if (bom.active === false || bom.lines.length === 0) continue;
    if (!bomsByParentItemId.has(bom.parentItemId)) bomsByParentItemId.set(bom.parentItemId, bom);
  }

  const resolved = new Map<string, ResolvedItemUnitCost>();
  const resolving = new Set<string>();

  const resolve = (itemId: string): ResolvedItemUnitCost | null => {
    const existing = resolved.get(itemId);
    if (existing) return existing;
    if (resolving.has(itemId)) return null;

    const item = itemsById.get(itemId);
    if (!item) return null;

    const landed = landedCostIndex.get(itemId);
    if (landed && Number.isFinite(landed.landedUnitCost) && landed.landedUnitCost > 0) {
      const landedResult: ResolvedItemUnitCost = {
        itemId,
        sku: item.sku,
        unitCost: landed.landedUnitCost,
        currency: DEFAULT_CURRENCY,
        source: "ACCOUNTING_LANDED_COST",
        sourceLabel: `Accounting landed cost · ${landed.quantity} units`,
        sourceRefs: landed.sourceRefs
      };
      resolved.set(itemId, landedResult);
      return landedResult;
    }

    const manualUnitCost = numericCost(item.estimatedUnitCost);
    if (manualUnitCost !== null) {
      const manualResult: ResolvedItemUnitCost = {
        itemId,
        sku: item.sku,
        unitCost: convertUnitCostToUsd(manualUnitCost, item.costCurrency, conversionOptions),
        currency: DEFAULT_CURRENCY,
        source: "ITEM_UNIT_COST",
        sourceLabel: "Item unit cost",
        sourceRefs: item.costSourceRef ? [item.costSourceRef] : []
      };
      resolved.set(itemId, manualResult);
      return manualResult;
    }

    if (item.category !== "FINISHED_GOOD") return null;

    const bom = bomsByParentItemId.get(itemId);
    if (!bom) return null;

    resolving.add(itemId);
    const componentCosts: Array<{ sku: string; quantity: number; unitCost: number }> = [];
    for (const line of bom.lines) {
      const component = resolve(line.componentItemId);
      const quantity = numericQuantity(line.quantity);
      if (!component || quantity <= 0) {
        resolving.delete(itemId);
        return null;
      }
      componentCosts.push({
        sku: line.componentItem?.sku ?? component.sku,
        quantity,
        unitCost: component.unitCost
      });
    }
    resolving.delete(itemId);

    const unitCost = roundUnitCost(componentCosts.reduce((total, line) => total + line.unitCost * line.quantity, 0));
    if (!Number.isFinite(unitCost) || unitCost <= 0) return null;

    const bomResult: ResolvedItemUnitCost = {
      itemId,
      sku: item.sku,
      unitCost,
      currency: DEFAULT_CURRENCY,
      source: "BOM_ROLLUP",
      sourceLabel: `BOM rollup · ${bom.version}`,
      sourceRefs: [`BOM ${bom.version}: ${componentCosts.map((line) => `${line.quantity} × ${line.sku} @ ${line.unitCost.toFixed(4)}`).join("; ")}`]
    };
    resolved.set(itemId, bomResult);
    return bomResult;
  };

  for (const item of items) resolve(item.id);
  return resolved;
}

export async function getResolvedActiveItemUnitCostIndex(options: { landedCostIndex?: Map<string, ItemLandedCostSummary> } = {}) {
  const [items, boms] = await Promise.all([
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      select: { id: true, sku: true, description: true, category: true, estimatedUnitCost: true, costCurrency: true, costSourceRef: true },
      orderBy: { sku: "asc" }
    }),
    prisma.bOM.findMany({
      where: { active: true, parentItem: { lifecycleStatus: { not: "OBSOLETE" } } },
      include: { lines: { include: { componentItem: { select: { sku: true } } }, orderBy: { id: "asc" } } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    })
  ]);
  const landedCostIndex = options.landedCostIndex ?? await getItemLandedCostIndex();
  const liveRates = await getLiveUsdConversionRates();
  return resolveItemUnitCostIndex(items, boms, landedCostIndex, { rates: liveRates.rates });
}

export async function getActivePricedItemValuationInputs(): Promise<PricedItemValuationInput[]> {
  const [items, landedCostIndex] = await Promise.all([
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      include: { stockMovements: { select: { movementType: true, quantity: true } } },
      orderBy: { sku: "asc" }
    }),
    getItemLandedCostIndex()
  ]);
  const boms = await prisma.bOM.findMany({
    where: { active: true, parentItem: { lifecycleStatus: { not: "OBSOLETE" } } },
    include: { lines: { include: { componentItem: { select: { sku: true } } }, orderBy: { id: "asc" } } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
  const liveRates = await getLiveUsdConversionRates();
  const unitCostIndex = resolveItemUnitCostIndex(items, boms, landedCostIndex, { rates: liveRates.rates });

  return items.map((item) => {
    const unitCost = unitCostIndex.get(item.id);
    return {
      itemId: item.id,
      sku: item.sku,
      description: item.description,
      category: item.category,
      useGroupOverride: item.useGroupOverride,
      unitCost: unitCost?.unitCost ?? null,
      currency: unitCost?.currency ?? DEFAULT_CURRENCY,
      movements: item.stockMovements as Array<{ movementType: MovementType; quantity: number | { toNumber(): number } }>
    };
  });
}

function numericCost(value: ItemForUnitCost["estimatedUnitCost"]) {
  if (value === null || value === undefined) return null;
  const numberValue = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function numericQuantity(value: number | { toString(): string }) {
  const numberValue = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numberValue) ? numberValue : 0;
}
