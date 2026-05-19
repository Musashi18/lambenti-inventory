export type StockSummary = {
  itemId: string;
  sku: string;
  description: string;
  reorderPoint: number;
  targetStock: number;
  onHand: number;
  reserved: number;
  available: number;
};

export type ShortageSummary = {
  itemId: string;
  sku: string;
  demand: number;
  available: number;
  shortage: number;
};

