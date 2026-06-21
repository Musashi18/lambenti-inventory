import { roundCurrency, roundUnitCost } from "@/modules/currency";

export type OrderCostLineInput = {
  quantity: number;
  unitPrice?: number | null;
  lineTotal?: number | null;
};

export type LandedOrderLineCost = OrderCostLineInput & {
  baseTotal: number;
  shippingAllocated: number;
  taxAllocated: number;
  dutyAllocated: number;
  brokerageAllocated: number;
  otherAllocated: number;
  landedTotal: number;
  landedUnitCost: number;
};

export type LandedOrderCharges = {
  shipping?: number | null;
  tax?: number | null;
  duty?: number | null;
  brokerage?: number | null;
  other?: number | null;
};

/**
 * Split an order-level monetary amount across item lines.
 *
 * Policy: allocate by extended merchandise value because shipping, duty, and fees
 * should follow the economic value of the shipment instead of overburdening cheap
 * high-quantity parts. If no line has a value basis, fall back to quantity. The
 * returned rounded allocations always sum back to the rounded order-level amount.
 */
export function allocateOrderLevelCost(amount: number | null | undefined, lines: OrderCostLineInput[]) {
  const roundedAmount = roundCurrency(safeNumber(amount));
  if (lines.length === 0) return [];
  if (roundedAmount === 0) return lines.map(() => 0);

  const valueBases = lines.map(lineMerchandiseBasis);
  const hasValueBasis = valueBases.some((basis) => basis > 0);
  const quantityBases = lines.map((line) => Math.max(0, line.quantity));
  const bases = hasValueBasis ? valueBases : quantityBases;
  return allocateRoundedByBasis(roundedAmount, bases, 2);
}

export function calculateLandedOrderLineCosts(lines: OrderCostLineInput[], charges: LandedOrderCharges = {}): LandedOrderLineCost[] {
  const shipping = allocateOrderLevelCost(charges.shipping, lines);
  const tax = allocateOrderLevelCost(charges.tax, lines);
  const duty = allocateOrderLevelCost(charges.duty, lines);
  const brokerage = allocateOrderLevelCost(charges.brokerage, lines);
  const other = allocateOrderLevelCost(charges.other, lines);

  return lines.map((line, index) => {
    const baseTotal = roundCurrency(lineMerchandiseBasis(line));
    const shippingAllocated = shipping[index] ?? 0;
    const taxAllocated = tax[index] ?? 0;
    const dutyAllocated = duty[index] ?? 0;
    const brokerageAllocated = brokerage[index] ?? 0;
    const otherAllocated = other[index] ?? 0;
    const landedTotal = roundCurrency(baseTotal + shippingAllocated + taxAllocated + dutyAllocated + brokerageAllocated + otherAllocated);
    return {
      ...line,
      baseTotal,
      shippingAllocated,
      taxAllocated,
      dutyAllocated,
      brokerageAllocated,
      otherAllocated,
      landedTotal,
      landedUnitCost: line.quantity > 0 ? roundUnitCost(landedTotal / line.quantity) : roundUnitCost(safeNumber(line.unitPrice))
    };
  });
}

function allocateRoundedByBasis(amount: number, bases: number[], decimals: number) {
  if (bases.length === 0) return [];
  const scale = 10 ** decimals;
  const totalUnits = Math.round(amount * scale);
  const sign = totalUnits < 0 ? -1 : 1;
  const absoluteUnits = Math.abs(totalUnits);
  const positiveBases = bases.map((basis) => Math.max(0, safeNumber(basis)));
  const totalBasis = positiveBases.reduce((total, basis) => total + basis, 0);

  if (totalBasis <= 0) {
    const baseUnits = Math.floor(absoluteUnits / bases.length);
    let remainder = absoluteUnits - baseUnits * bases.length;
    return bases.map(() => {
      const units = baseUnits + (remainder-- > 0 ? 1 : 0);
      return sign * units / scale;
    });
  }

  const raw = positiveBases.map((basis, index) => {
    const exactUnits = (absoluteUnits * basis) / totalBasis;
    const floorUnits = Math.floor(exactUnits);
    return { index, floorUnits, remainder: exactUnits - floorUnits };
  });
  let assigned = raw.reduce((total, item) => total + item.floorUnits, 0);
  let remaining = absoluteUnits - assigned;
  const unitsByIndex = raw.map((item) => item.floorUnits);

  for (const item of [...raw].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    unitsByIndex[item.index] += 1;
    assigned += 1;
    remaining -= 1;
  }

  return unitsByIndex.map((units) => sign * units / scale);
}

function lineMerchandiseBasis(line: OrderCostLineInput) {
  const explicitLineTotal = safeNumber(line.lineTotal);
  if (explicitLineTotal > 0) return explicitLineTotal;
  const unitPrice = safeNumber(line.unitPrice);
  return unitPrice > 0 && line.quantity > 0 ? unitPrice * line.quantity : 0;
}

function safeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
