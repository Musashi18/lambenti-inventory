export const DISPLAY_QUANTITY_DECIMALS = 2;

export function roundDisplayQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 10 ** DISPLAY_QUANTITY_DECIMALS) / 10 ** DISPLAY_QUANTITY_DECIMALS;
}

export function formatQuantity(value: number, options: { fixed?: boolean } = {}) {
  const rounded = roundDisplayQuantity(value);
  if (options.fixed) return rounded.toFixed(DISPLAY_QUANTITY_DECIMALS);
  return rounded.toFixed(DISPLAY_QUANTITY_DECIMALS).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
