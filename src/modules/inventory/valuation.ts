import type { MovementType } from "@prisma/client";
import { convertUnitCostToUsd, type CurrencyRates } from "@/modules/currency";
import { groupItemOptionsByUse, sortItemsByUseGroup } from "./item-option-groups";
import { calculateStockPosition } from "./ledger";
import { roundDisplayQuantity } from "./quantity-format";

export type LotValuationInput = {
  itemId: string;
  sku: string;
  lotCode: string;
  unitCost: number;
  movements: Array<{
    movementType: MovementType;
    quantity: number | { toNumber(): number };
  }>;
};

export type LotValuationRow = {
  itemId: string;
  sku: string;
  lotCode: string;
  onHand: number;
  reserved: number;
  available: number;
  unitCost: number;
  value: number;
};

export type PricedItemCostSource = "ACCOUNTING_LANDED_COST" | "ITEM_UNIT_COST" | "BOM_ROLLUP";

export type PricedItemValuationInput = {
  itemId: string;
  sku: string;
  description: string;
  category?: string | null;
  useGroupOverride?: string | null;
  unitCost: number | null;
  currency: string;
  costSource?: PricedItemCostSource | null;
  costSourceLabel?: string | null;
  costSourceRefs?: string[];
  movements: Array<{
    movementType: MovementType;
    quantity: number | { toNumber(): number };
  }>;
};

export type PricedItemValuationRow = {
  itemId: string;
  sku: string;
  description: string;
  category?: string | null;
  useGroupOverride?: string | null;
  quantity: number;
  unitCost: number;
  currency: string;
  costSource?: PricedItemCostSource | null;
  costSourceLabel?: string | null;
  costSourceRefs: string[];
  value: number;
};

export type PricedItemValuationGroup = {
  key: string;
  label: string;
  rows: PricedItemValuationRow[];
  totalValue: number;
};

export function calculateLotValuations(lots: LotValuationInput[]): {
  rows: LotValuationRow[];
  totalValue: number;
} {
  const rows = lots.map((lot) => {
    const position = calculateStockPosition(lot.movements);
    return {
      itemId: lot.itemId,
      sku: lot.sku,
      lotCode: lot.lotCode,
      onHand: position.onHand,
      reserved: position.reserved,
      available: position.available,
      unitCost: lot.unitCost,
      value: roundCurrency(position.onHand * lot.unitCost)
    };
  });

  return {
    rows,
    totalValue: roundCurrency(rows.reduce((total, row) => total + row.value, 0))
  };
}

export function calculatePricedItemValuations(
  items: PricedItemValuationInput[],
  options: { rates?: CurrencyRates } = {}
): {
  rows: PricedItemValuationRow[];
  totalValue: number;
} {
  const rows = items
    .filter((item) => item.unitCost !== null && Number.isFinite(item.unitCost))
    .map((item) => {
      const position = calculateStockPosition(item.movements);
      const unitCost = convertUnitCostToUsd(item.unitCost ?? 0, item.currency, { rates: options.rates });
      const quantity = roundDisplayQuantity(position.onHand);
      return {
        itemId: item.itemId,
        sku: item.sku,
        description: item.description,
        ...(item.category !== undefined ? { category: item.category } : {}),
        ...(item.useGroupOverride !== undefined ? { useGroupOverride: item.useGroupOverride } : {}),
        quantity,
        unitCost,
        currency: "USD",
        ...(item.costSource !== undefined ? { costSource: item.costSource } : {}),
        ...(item.costSourceLabel !== undefined ? { costSourceLabel: item.costSourceLabel } : {}),
        costSourceRefs: item.costSourceRefs ?? [],
        value: roundCurrency(quantity * unitCost)
      };
    });

  return {
    rows: sortItemsByUseGroup(rows),
    totalValue: roundCurrency(rows.reduce((total, row) => total + row.value, 0))
  };
}

export function groupPricedItemValuationsByItemType(rows: PricedItemValuationRow[]): PricedItemValuationGroup[] {
  return groupItemOptionsByUse(
    rows.map((row) => ({
      id: row.itemId,
      sku: row.sku,
      description: row.description,
      category: row.category,
      useGroupOverride: row.useGroupOverride,
      row
    }))
  ).map((group) => {
    const groupRows = group.items.map((item) => item.row);
    return {
      key: group.key,
      label: group.label,
      rows: groupRows,
      totalValue: roundCurrency(groupRows.reduce((total, row) => total + row.value, 0))
    };
  });
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
