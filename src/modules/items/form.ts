import { CostConfidence, ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { z } from "zod";
import { normalizeCostToUsd, type CurrencyRates } from "@/modules/currency";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const optionalNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().min(0).optional()
);

export const itemFormSchema = z.object({
  sku: z.string().trim().min(1),
  manufacturerPartNo: optionalText,
  supplierSku: optionalText,
  description: z.string().trim().min(1),
  category: z.nativeEnum(ItemCategory),
  unit: z.nativeEnum(Unit),
  reorderPoint: z.coerce.number().int().min(0),
  targetStock: z.coerce.number().int().min(0),
  leadTimeDays: z.coerce.number().int().min(0),
  preferredSupplierId: optionalText,
  customSupplierName: optionalText,
  lifecycleStatus: z.nativeEnum(LifecycleStatus),
  estimatedUnitCost: optionalNumber,
  costCurrency: z.string().trim().min(3).max(3).default("USD"),
  costConfidence: z.nativeEnum(CostConfidence).default(CostConfidence.UNKNOWN),
  costSourceRef: optionalText
});

export type ItemFormInput = z.infer<typeof itemFormSchema>;

export function parseItemFormData(formData: FormData, options: { rates?: CurrencyRates } = {}): ItemFormInput {
  const entries: Record<string, FormDataEntryValue> = {};
  formData.forEach((value, key) => {
    entries[key] = value;
  });

  const parsed = itemFormSchema.parse(entries);
  const normalizedCost = normalizeCostToUsd(parsed.estimatedUnitCost, parsed.costCurrency, { rates: options.rates });
  return {
    ...parsed,
    estimatedUnitCost: normalizedCost.estimatedUnitCost,
    costCurrency: normalizedCost.costCurrency
  };
}
