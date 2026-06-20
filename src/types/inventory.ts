export type StockSummary = {
  itemId: string;
  sku: string;
  description: string;
  category?: string | null;
  reorderPoint: number;
  targetStock: number;
  onHand: number;
  reserved: number;
  available: number;
};

export type ShortageSummary = {
  itemId: string;
  sku: string;
  description: string;
  category?: string | null;
  demand: number;
  available: number;
  shortage: number;
};

