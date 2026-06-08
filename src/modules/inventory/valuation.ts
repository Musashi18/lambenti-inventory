import type { MovementType } from "@prisma/client";
import { convertToUsd, type CurrencyRates } from "@/modules/currency";
import { calculateStockPosition } from "./ledger";

export type LotValuationInput = {
  itemId: string;
  sku: string;
  lotCode: string;
  unitCost: number;
  movements: Array<{
    movementType: MovementType;
    quantity: number;
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

export type PricedItemValuationInput = {
  itemId: string;
  sku: string;
  description: string;
  unitCost: number | null;
  currency: string;
  movements: Array<{
    movementType: MovementType;
    quantity: number;
  }>;
};

export type PricedItemValuationRow = {
  itemId: string;
  sku: string;
  description: string;
  quantity: number;
  unitCost: number;
  currency: string;
  value: number;
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
      const unitCost = convertToUsd(item.unitCost ?? 0, item.currency, { rates: options.rates });
      return {
        itemId: item.itemId,
        sku: item.sku,
        description: item.description,
        quantity: position.onHand,
        unitCost,
        currency: "USD",
        value: roundCurrency(position.onHand * unitCost)
      };
    });

  return {
    rows,
    totalValue: roundCurrency(rows.reduce((total, row) => total + row.value, 0))
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
