import { CostConfidence, ItemCategory, LifecycleStatus, Prisma, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { normalizeCostToUsd } from "@/modules/currency";

export const ITEM_CSV_HEADERS = [
  "sku",
  "description",
  "category",
  "unit",
  "reorderPoint",
  "targetStock",
  "leadTimeDays",
  "lifecycleStatus",
  "manufacturerPartNo",
  "supplierSku",
  "preferredSupplierId",
  "estimatedUnitCost",
  "costCurrency",
  "costConfidence",
  "costSourceRef"
] as const;

type ItemCsvHeader = typeof ITEM_CSV_HEADERS[number];

export type ItemCsvRow = {
  sku: string;
  description: string;
  category: ItemCategory;
  unit: Unit;
  reorderPoint: number;
  targetStock: number;
  leadTimeDays: number;
  lifecycleStatus: LifecycleStatus;
  manufacturerPartNo?: string;
  supplierSku?: string;
  preferredSupplierId?: string;
  estimatedUnitCost?: number;
  costCurrency: string;
  costConfidence: CostConfidence;
  costSourceRef?: string;
};

export type ItemCsvImportError = {
  row: number;
  field: string;
  message: string;
};

export type ItemCsvImportPreview = {
  valid: boolean;
  rows: ItemCsvRow[];
  errors: ItemCsvImportError[];
};

export type ItemCsvImportResult = ItemCsvImportPreview & {
  createdCount: number;
};

const REQUIRED_HEADERS: ItemCsvHeader[] = [
  "sku",
  "description",
  "category",
  "unit",
  "reorderPoint",
  "targetStock",
  "leadTimeDays",
  "lifecycleStatus",
  "costCurrency"
];

const ITEM_CATEGORY_VALUES = new Set<string>(Object.values(ItemCategory));
const UNIT_VALUES = new Set<string>(Object.values(Unit));
const LIFECYCLE_STATUS_VALUES = new Set<string>(Object.values(LifecycleStatus));
const COST_CONFIDENCE_VALUES = new Set<string>(Object.values(CostConfidence));

export function exportItemsToCsv(rows: ItemCsvRow[]) {
  return [
    ITEM_CSV_HEADERS.join(","),
    ...rows.map((row) => ITEM_CSV_HEADERS.map((header) => csvValue(row[header])).join(","))
  ].join("\n");
}

export async function previewItemCsvImport(csv: string): Promise<ItemCsvImportPreview> {
  const parsed = parseCsv(csv);
  const errors: ItemCsvImportError[] = [];

  if (parsed.length === 0 || parsed.every((row) => row.every((cell) => cell.trim() === ""))) {
    return {
      valid: false,
      rows: [],
      errors: [{ row: 1, field: "csv", message: "CSV import must include a header row and at least one item row." }]
    };
  }

  const headers = parsed[0].map((header) => header.trim());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  for (const requiredHeader of REQUIRED_HEADERS) {
    if (!headerIndex.has(requiredHeader)) {
      errors.push({ row: 1, field: requiredHeader, message: `Missing required CSV header: ${requiredHeader}.` });
    }
  }

  const parsedRows: ItemCsvRow[] = [];
  const seenSkus = new Map<string, number>();
  const candidateSkus: string[] = [];

  for (let index = 1; index < parsed.length; index += 1) {
    const sourceRow = parsed[index];
    const rowNumber = index + 1;
    if (sourceRow.every((cell) => cell.trim() === "")) continue;

    const row = parseItemRow(sourceRow, headerIndex, rowNumber, errors);
    if (!row) continue;

    const firstSeenRow = seenSkus.get(row.sku);
    if (firstSeenRow) {
      errors.push({ row: rowNumber, field: "sku", message: `Duplicate SKU ${row.sku} in CSV; first seen on row ${firstSeenRow}.` });
    } else {
      seenSkus.set(row.sku, rowNumber);
    }

    candidateSkus.push(row.sku);
    parsedRows.push(row);
  }

  if (candidateSkus.length > 0) {
    const existing = await prisma.item.findMany({
      where: { sku: { in: candidateSkus } },
      select: { sku: true }
    });
    const existingSkus = new Set(existing.map((item) => item.sku));
    for (const [sku, rowNumber] of seenSkus.entries()) {
      if (existingSkus.has(sku)) {
        errors.push({ row: rowNumber, field: "sku", message: `SKU ${sku} already exists; edit the existing item or choose a new internal SKU.` });
      }
    }
  }

  return {
    valid: errors.length === 0,
    rows: errors.length === 0 ? parsedRows : [],
    errors
  };
}

export async function importItemsFromCsv(input: {
  csv: string;
  storageLocationId: string;
  actorId: string;
}): Promise<ItemCsvImportResult> {
  const preview = await previewItemCsvImport(input.csv);
  const errors = [...preview.errors];

  const storageLocation = await prisma.storageLocation.findUnique({
    where: { id: input.storageLocationId },
    select: { id: true }
  });
  if (!storageLocation) {
    errors.push({ row: 1, field: "storageLocationId", message: "Storage location for imported items does not exist." });
  }

  if (errors.length > 0) {
    return { valid: false, rows: [], errors, createdCount: 0 };
  }

  const createdCount = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const row of preview.rows) {
      const item = await tx.item.create({
        data: {
          sku: row.sku,
          manufacturerPartNo: row.manufacturerPartNo ?? null,
          supplierSku: row.supplierSku ?? null,
          description: row.description,
          category: row.category,
          unit: row.unit,
          reorderPoint: row.reorderPoint,
          targetStock: row.targetStock,
          leadTimeDays: row.leadTimeDays,
          lifecycleStatus: row.lifecycleStatus,
          preferredSupplierId: row.preferredSupplierId ?? null,
          storageLocationId: input.storageLocationId,
          estimatedUnitCost: row.estimatedUnitCost ?? null,
          costCurrency: row.costCurrency,
          costConfidence: row.costConfidence,
          costSourceRef: row.costSourceRef ?? null
        }
      });

      await writeAuditLog({
        actorType: "USER",
        actorId: input.actorId,
        action: "IMPORT_ITEM_CSV_CREATE_ITEM",
        entityType: "Item",
        entityId: item.id,
        payload: row
      }, tx);
      count += 1;
    }
    return count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { ...preview, createdCount };
}

function parseItemRow(
  sourceRow: string[],
  headerIndex: Map<string, number>,
  rowNumber: number,
  errors: ItemCsvImportError[]
): ItemCsvRow | null {
  const sku = getCell(sourceRow, headerIndex, "sku").trim();
  const description = getCell(sourceRow, headerIndex, "description").trim();
  const category = getCell(sourceRow, headerIndex, "category").trim();
  const unit = getCell(sourceRow, headerIndex, "unit").trim();
  const lifecycleStatus = getCell(sourceRow, headerIndex, "lifecycleStatus").trim();
  const rawCostCurrency = getCell(sourceRow, headerIndex, "costCurrency").trim().toUpperCase();
  const costCurrency = rawCostCurrency || "USD";
  const costConfidence = optionalText(getCell(sourceRow, headerIndex, "costConfidence")) ?? CostConfidence.UNKNOWN;
  const reorderPoint = parseRequiredInteger(sourceRow, headerIndex, "reorderPoint", rowNumber, errors);
  const targetStock = parseRequiredInteger(sourceRow, headerIndex, "targetStock", rowNumber, errors);
  const leadTimeDays = parseRequiredInteger(sourceRow, headerIndex, "leadTimeDays", rowNumber, errors);
  const estimatedUnitCost = parseOptionalNumber(sourceRow, headerIndex, "estimatedUnitCost", rowNumber, errors);

  if (!sku) errors.push({ row: rowNumber, field: "sku", message: "SKU is required." });
  if (!description) errors.push({ row: rowNumber, field: "description", message: "Description is required." });
  if (!ITEM_CATEGORY_VALUES.has(category)) errors.push({ row: rowNumber, field: "category", message: `category must be one of ${Array.from(ITEM_CATEGORY_VALUES).join(", ")}.` });
  if (!UNIT_VALUES.has(unit)) errors.push({ row: rowNumber, field: "unit", message: `unit must be one of ${Array.from(UNIT_VALUES).join(", ")}.` });
  if (!LIFECYCLE_STATUS_VALUES.has(lifecycleStatus)) errors.push({ row: rowNumber, field: "lifecycleStatus", message: `lifecycleStatus must be one of ${Array.from(LIFECYCLE_STATUS_VALUES).join(", ")}.` });
  if (!/^[A-Z]{3}$/.test(costCurrency)) errors.push({ row: rowNumber, field: "costCurrency", message: "costCurrency must be a three-letter ISO currency code such as USD or CAD." });
  if (!COST_CONFIDENCE_VALUES.has(costConfidence)) errors.push({ row: rowNumber, field: "costConfidence", message: `costConfidence must be one of ${Array.from(COST_CONFIDENCE_VALUES).join(", ")}.` });

  const optionalFields = {
    manufacturerPartNo: optionalText(getCell(sourceRow, headerIndex, "manufacturerPartNo")),
    supplierSku: optionalText(getCell(sourceRow, headerIndex, "supplierSku")),
    preferredSupplierId: optionalText(getCell(sourceRow, headerIndex, "preferredSupplierId")),
    costSourceRef: optionalText(getCell(sourceRow, headerIndex, "costSourceRef"))
  };

  if (!sku || !description || !ITEM_CATEGORY_VALUES.has(category) || !UNIT_VALUES.has(unit) || !LIFECYCLE_STATUS_VALUES.has(lifecycleStatus) || !COST_CONFIDENCE_VALUES.has(costConfidence) || !/^[A-Z]{3}$/.test(costCurrency)) {
    return null;
  }
  if (reorderPoint === null || targetStock === null || leadTimeDays === null || estimatedUnitCost === null) {
    return null;
  }

  const normalizedCost = normalizeCostToUsd(estimatedUnitCost, costCurrency);

  return {
    sku,
    description,
    category: category as ItemCategory,
    unit: unit as Unit,
    reorderPoint,
    targetStock,
    leadTimeDays,
    lifecycleStatus: lifecycleStatus as LifecycleStatus,
    estimatedUnitCost: normalizedCost.estimatedUnitCost,
    costCurrency: normalizedCost.costCurrency,
    costConfidence: costConfidence as CostConfidence,
    ...optionalFields
  };
}

function parseRequiredInteger(
  sourceRow: string[],
  headerIndex: Map<string, number>,
  field: ItemCsvHeader,
  rowNumber: number,
  errors: ItemCsvImportError[]
) {
  const raw = getCell(sourceRow, headerIndex, field).trim();
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 0) {
    errors.push({ row: rowNumber, field, message: `${field} must be a non-negative integer.` });
    return null;
  }
  return value;
}

function parseOptionalNumber(
  sourceRow: string[],
  headerIndex: Map<string, number>,
  field: ItemCsvHeader,
  rowNumber: number,
  errors: ItemCsvImportError[]
) {
  const raw = getCell(sourceRow, headerIndex, field).trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    errors.push({ row: rowNumber, field, message: `${field} must be a non-negative number when provided.` });
    return null;
  }
  return value;
}

function getCell(sourceRow: string[], headerIndex: Map<string, number>, header: ItemCsvHeader) {
  const index = headerIndex.get(header);
  if (index === undefined) return "";
  return sourceRow[index] ?? "";
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}
