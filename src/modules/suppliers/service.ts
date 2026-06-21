import { CostConfidence, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export async function getSupplierComparison() {
  return prisma.supplierOffer.findMany({
    where: { item: { lifecycleStatus: { not: "OBSOLETE" } } },
    include: {
      supplier: true,
      item: true
    },
    orderBy: [{ item: { category: "asc" } }, { item: { sku: "asc" } }, { leadTimeDays: "asc" }]
  });
}

export type ItemSupplierEntry = {
  itemId: string;
  sku: string;
  description: string;
  category: string;
  useGroupOverride: string | null;
  cleanItemType: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  unitPriceUsd: number | null;
  costConfidence: CostConfidence;
  costSourceRef: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
};

export type ConfirmedSupplierOption = {
  id: string;
  name: string;
};

export type ActiveSupplierOption = ConfirmedSupplierOption;

export type SupplierProfile = {
  id: string;
  name: string;
  displayName: string;
  companyName: string;
  contactEmail: string;
  contactName: string;
  companyRevenue: string;
  foundedYear: string;
  address: string;
  productPageUrl: string;
  leadTimeDays: number;
  sourceLabel: string;
  confirmedByHuman: boolean;
  archivedAt: string;
  archiveReason: string;
};

export type SupplierCleanupCandidate = SupplierProfile & {
  reason: string;
  emailImportCount: number;
};

type SupplierOptionCandidate = {
  name: string;
  confirmedByHuman?: boolean | null;
  companyName?: string | null;
  contactEmail?: string | null;
  contactName?: string | null;
  companyRevenue?: Prisma.Decimal | number | string | null;
  foundedYear?: number | null;
  address?: string | null;
  productPageUrl?: string | null;
  leadTimeDays?: number | null;
  archivedAt?: Date | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
  supplierOfferCount?: number;
  preferredItemCount?: number;
  purchaseRequestCount?: number;
  purchaseOrderCount?: number;
  invoiceCount?: number;
  emailImportCount?: number;
};

type SupplierProfileCandidate = SupplierOptionCandidate & {
  id: string;
  productPageUrl?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

type SupplierWriteClient = Pick<typeof prisma, "supplier" | "auditLog">;

export async function getActiveSupplierOptions(): Promise<ActiveSupplierOption[]> {
  const profiles = await getUniqueSupplierProfiles();
  return profiles.map((supplier) => ({
    id: supplier.id,
    name: supplier.displayName
  }));
}

export async function getConfirmedSupplierOptions(): Promise<ConfirmedSupplierOption[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      confirmedByHuman: true,
      companyName: true,
      contactEmail: true,
      contactName: true,
      companyRevenue: true,
      foundedYear: true,
      address: true,
      _count: {
        select: {
          offers: true,
          preferredFor: true,
          purchaseRequests: true,
          purchaseOrders: true,
          invoices: true,
          emailOrderImports: true
        }
      }
    }
  });

  return suppliers
    .filter((supplier) => isConfirmedSupplierOptionCandidate({
      name: supplier.name,
      confirmedByHuman: supplier.confirmedByHuman,
      companyName: supplier.companyName,
      contactEmail: supplier.contactEmail,
      contactName: supplier.contactName,
      companyRevenue: supplier.companyRevenue,
      foundedYear: supplier.foundedYear,
      address: supplier.address,
      supplierOfferCount: supplier._count.offers,
      preferredItemCount: supplier._count.preferredFor,
      purchaseRequestCount: supplier._count.purchaseRequests,
      purchaseOrderCount: supplier._count.purchaseOrders,
      invoiceCount: supplier._count.invoices,
      emailImportCount: supplier._count.emailOrderImports
    }))
    .map((supplier) => ({
      id: supplier.id,
      name: cleanConfirmedSupplierOptionName(supplier)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUniqueSupplierProfiles(): Promise<SupplierProfile[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      confirmedByHuman: true,
      companyName: true,
      contactEmail: true,
      contactName: true,
      companyRevenue: true,
      foundedYear: true,
      address: true,
      productPageUrl: true,
      leadTimeDays: true,
      archivedAt: true,
      archivedBy: true,
      archiveReason: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          offers: true,
          preferredFor: true,
          purchaseRequests: true,
          purchaseOrders: true,
          invoices: true,
          emailOrderImports: true
        }
      }
    }
  });

  return filterOneSupplierPerSource(suppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    confirmedByHuman: supplier.confirmedByHuman,
    companyName: supplier.companyName,
    contactEmail: supplier.contactEmail,
    contactName: supplier.contactName,
    companyRevenue: supplier.companyRevenue,
    foundedYear: supplier.foundedYear,
    address: supplier.address,
    productPageUrl: supplier.productPageUrl,
    leadTimeDays: supplier.leadTimeDays,
    archivedAt: supplier.archivedAt,
    archivedBy: supplier.archivedBy,
    archiveReason: supplier.archiveReason,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    supplierOfferCount: supplier._count.offers,
    preferredItemCount: supplier._count.preferredFor,
    purchaseRequestCount: supplier._count.purchaseRequests,
    purchaseOrderCount: supplier._count.purchaseOrders,
    invoiceCount: supplier._count.invoices,
    emailImportCount: supplier._count.emailOrderImports
  }))).map(toSupplierProfile);
}

export async function getArchivedSupplierProfiles(): Promise<SupplierProfile[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { archivedAt: { not: null } },
    orderBy: [{ archivedAt: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      confirmedByHuman: true,
      companyName: true,
      contactEmail: true,
      contactName: true,
      companyRevenue: true,
      foundedYear: true,
      address: true,
      productPageUrl: true,
      leadTimeDays: true,
      archivedAt: true,
      archivedBy: true,
      archiveReason: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          offers: true,
          preferredFor: true,
          purchaseRequests: true,
          purchaseOrders: true,
          invoices: true,
          emailOrderImports: true
        }
      }
    }
  });

  return suppliers.map((supplier) => toSupplierProfile({
    id: supplier.id,
    name: supplier.name,
    confirmedByHuman: supplier.confirmedByHuman,
    companyName: supplier.companyName,
    contactEmail: supplier.contactEmail,
    contactName: supplier.contactName,
    companyRevenue: supplier.companyRevenue,
    foundedYear: supplier.foundedYear,
    address: supplier.address,
    productPageUrl: supplier.productPageUrl,
    leadTimeDays: supplier.leadTimeDays,
    archivedAt: supplier.archivedAt,
    archivedBy: supplier.archivedBy,
    archiveReason: supplier.archiveReason,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    supplierOfferCount: supplier._count.offers,
    preferredItemCount: supplier._count.preferredFor,
    purchaseRequestCount: supplier._count.purchaseRequests,
    purchaseOrderCount: supplier._count.purchaseOrders,
    invoiceCount: supplier._count.invoices,
    emailImportCount: supplier._count.emailOrderImports
  }));
}

export async function getSupplierCleanupCandidates(): Promise<SupplierCleanupCandidate[]> {
  const suppliers = await prisma.supplier.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: supplierCleanupSelect()
  });

  return suppliers
    .map((supplier) => supplierCleanupCandidate(supplier))
    .filter((candidate): candidate is SupplierCleanupCandidate => candidate !== null);
}

export async function archiveSupplierCleanupCandidates(input: {
  actorId: string;
  actorType?: "USER" | "AGENT";
  candidateIds?: string[];
}) {
  return prisma.$transaction(async (tx) => {
    const candidateIdSet = input.candidateIds?.length ? new Set(input.candidateIds) : null;
    const suppliers = await tx.supplier.findMany({
      where: {
        archivedAt: null,
        ...(candidateIdSet ? { id: { in: Array.from(candidateIdSet) } } : {})
      },
      orderBy: { name: "asc" },
      select: supplierCleanupSelect()
    });
    const candidates = suppliers
      .map((supplier) => supplierCleanupCandidate(supplier))
      .filter((candidate): candidate is SupplierCleanupCandidate => candidate !== null);

    for (const candidate of candidates) {
      const supplier = await tx.supplier.update({
        where: { id: candidate.id },
        data: {
          archivedAt: new Date(),
          archivedBy: input.actorId,
          archiveReason: `Auto-quarantined import/UI supplier junk: ${candidate.reason}`
        }
      });

      await writeAuditLog({
        actorType: input.actorType ?? "USER",
        actorId: input.actorId,
        action: "ARCHIVE_SUPPLIER_IMPORT_JUNK",
        entityType: "Supplier",
        entityId: supplier.id,
        payload: {
          supplierName: supplier.name,
          reason: candidate.reason,
          emailImportCount: candidate.emailImportCount,
          note: "Auto-quarantined only because the supplier had no preferred items, offers, purchase requests, purchase orders, or invoices. Historical email evidence is preserved."
        }
      }, tx);
    }

    return { archivedCount: candidates.length, candidates };
  });
}

function supplierCleanupSelect() {
  return {
    id: true,
    name: true,
    confirmedByHuman: true,
    companyName: true,
    contactEmail: true,
    contactName: true,
    companyRevenue: true,
    foundedYear: true,
    address: true,
    productPageUrl: true,
    leadTimeDays: true,
    archivedAt: true,
    archivedBy: true,
    archiveReason: true,
    createdAt: true,
    updatedAt: true,
    _count: {
      select: {
        offers: true,
        preferredFor: true,
        purchaseRequests: true,
        purchaseOrders: true,
        invoices: true,
        emailOrderImports: true
      }
    }
  } as const;
}

type SupplierCleanupRow = Prisma.SupplierGetPayload<{ select: ReturnType<typeof supplierCleanupSelect> }>;

function supplierCleanupCandidate(supplier: SupplierCleanupRow): SupplierCleanupCandidate | null {
  const candidate: SupplierProfileCandidate = {
    id: supplier.id,
    name: supplier.name,
    confirmedByHuman: supplier.confirmedByHuman,
    companyName: supplier.companyName,
    contactEmail: supplier.contactEmail,
    contactName: supplier.contactName,
    companyRevenue: supplier.companyRevenue,
    foundedYear: supplier.foundedYear,
    address: supplier.address,
    productPageUrl: supplier.productPageUrl,
    leadTimeDays: supplier.leadTimeDays,
    archivedAt: supplier.archivedAt,
    archivedBy: supplier.archivedBy,
    archiveReason: supplier.archiveReason,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    supplierOfferCount: supplier._count.offers,
    preferredItemCount: supplier._count.preferredFor,
    purchaseRequestCount: supplier._count.purchaseRequests,
    purchaseOrderCount: supplier._count.purchaseOrders,
    invoiceCount: supplier._count.invoices,
    emailImportCount: supplier._count.emailOrderImports
  };
  const reason = importedSupplierJunkReason(candidate.name) ?? importedSupplierJunkReason(cleanConfirmedSupplierOptionName(candidate));
  if (!reason) return null;
  if (candidate.confirmedByHuman) return null;
  if (hasOperationalSupplierReferences(candidate)) return null;
  return {
    ...toSupplierProfile(candidate),
    reason,
    emailImportCount: candidate.emailImportCount ?? 0
  };
}

function hasOperationalSupplierReferences(candidate: SupplierProfileCandidate) {
  return (candidate.preferredItemCount ?? 0) > 0
    || (candidate.supplierOfferCount ?? 0) > 0
    || (candidate.purchaseRequestCount ?? 0) > 0
    || (candidate.purchaseOrderCount ?? 0) > 0
    || (candidate.invoiceCount ?? 0) > 0;
}

export function filterOneSupplierPerSource<T extends SupplierProfileCandidate>(suppliers: T[]): T[] {
  const bySource = new Map<string, T>();

  for (const supplier of suppliers) {
    if (supplier.archivedAt) continue;
    if (!isDisplayableSupplierProfileCandidate(supplier)) continue;
    const sourceKey = supplierSourceKey(supplier);
    const current = bySource.get(sourceKey);
    if (!current || supplierProfileScore(supplier) > supplierProfileScore(current)) {
      bySource.set(sourceKey, supplier);
    }
  }

  return Array.from(bySource.values())
    .sort((a, b) => cleanConfirmedSupplierOptionName(a).localeCompare(cleanConfirmedSupplierOptionName(b)));
}

export function cleanConfirmedSupplierOptionName(input: Pick<SupplierOptionCandidate, "name" | "companyName">) {
  const preferred = extractEmbeddedSupplierCompany(input.companyName?.trim() || input.name) || input.companyName?.trim() || input.name;
  return preferred
    .replace(/^\s*(?:from|supplier|seller|store|company)\s*[:#-]\s*/i, "")
    .replace(/^"(.+)"$/, "$1")
    .replace(/<[^>]+@[^>]+>/g, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/^['\"]+|['\"]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isConfirmedSupplierOptionCandidate(candidate: SupplierOptionCandidate) {
  const cleanedName = cleanConfirmedSupplierOptionName(candidate);
  if (cleanedName.length < 2) return false;
  if (looksLikeEmailHeading(candidate.name) || looksLikeEmailHeading(cleanedName)) return false;
  if (looksLikeImportedEmailSentence(candidate.name) || looksLikeImportedEmailSentence(cleanedName)) return false;
  if (looksLikeGenericImportedSupplier(cleanedName)) return false;
  if (looksLikeImportedSupplierJunk(candidate.name) || looksLikeImportedSupplierJunk(cleanedName)) return false;
  if (!isValidSupplierIdentityName(cleanedName)) return false;
  if (!candidate.confirmedByHuman) return false;

  return true;
}

function isDisplayableSupplierProfileCandidate(candidate: SupplierProfileCandidate) {
  const cleanedName = cleanConfirmedSupplierOptionName(candidate);
  if (cleanedName.length < 2) return false;
  if (looksLikeEmailHeading(candidate.name) || looksLikeEmailHeading(cleanedName)) return false;
  if (looksLikeImportedEmailSentence(candidate.name) || looksLikeImportedEmailSentence(cleanedName)) return false;
  if (looksLikeGenericImportedSupplier(cleanedName)) return false;
  if (looksLikeImportedSupplierJunk(candidate.name) || looksLikeImportedSupplierJunk(cleanedName)) return false;
  if (looksLikeTestOrUselessSupplier(candidate.name) || looksLikeTestOrUselessSupplier(cleanedName)) return false;
  return isValidSupplierIdentityName(cleanedName);
}

function extractEmbeddedSupplierCompany(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const companyPattern = /([A-Z][A-Za-z0-9&.,' -]+?(?:Co\.?|Ltd\.?|Limited|Factory|Trading|Technology|Electronic|Electronics|Textile|Industrial|Import And Export)[A-Za-z0-9&.,' -]*?)(?=$|\s+(?:ok|will ship|\[read\]|great))/i;
  const afterDate = normalized.match(new RegExp(`\\b\\d{4}-\\d{1,2}-\\d{1,2}\\s+${companyPattern.source}`, "i"));
  if (afterDate?.[1]) return afterDate[1].trim();
  const leading = normalized.match(new RegExp(`^${companyPattern.source}`, "i"));
  return leading?.[1]?.trim();
}

function toSupplierProfile(supplier: SupplierProfileCandidate): SupplierProfile {
  return {
    id: supplier.id,
    name: supplier.name,
    displayName: cleanConfirmedSupplierOptionName(supplier),
    companyName: supplier.companyName?.toString().trim() ?? "",
    contactEmail: supplier.contactEmail?.trim() ?? "",
    contactName: supplier.contactName?.trim() ?? "",
    companyRevenue: supplier.companyRevenue === null || supplier.companyRevenue === undefined ? "" : supplier.companyRevenue.toString(),
    foundedYear: supplier.foundedYear?.toString() ?? "",
    address: supplier.address?.trim() ?? "",
    productPageUrl: supplier.productPageUrl?.trim() ?? "",
    leadTimeDays: supplier.leadTimeDays ?? 0,
    sourceLabel: supplierSourceLabel(supplier),
    confirmedByHuman: Boolean(supplier.confirmedByHuman),
    archivedAt: supplier.archivedAt?.toISOString() ?? "",
    archiveReason: supplier.archiveReason?.trim() ?? ""
  };
}

function supplierSourceKey(supplier: SupplierProfileCandidate) {
  const urlKey = normalizeSupplierUrl(supplier.productPageUrl);
  if (urlKey) return `url:${urlKey}`;
  const email = supplier.contactEmail?.trim().toLowerCase();
  if (email) return `email:${email}`;
  return `name:${canonicalSupplierIdentityKey(cleanConfirmedSupplierOptionName(supplier))}`;
}

function supplierSourceLabel(supplier: SupplierProfileCandidate) {
  const url = normalizeSupplierUrl(supplier.productPageUrl);
  if (url) return url;
  if (supplier.contactEmail) return supplier.contactEmail.trim().toLowerCase();
  return cleanConfirmedSupplierOptionName(supplier);
}

function normalizeSupplierUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return `${url.hostname}${url.pathname}`.replace(/\/+$/g, "").toLowerCase();
  } catch {
    return trimmed.replace(/[?#].*$/, "").replace(/\/+$/g, "").toLowerCase();
  }
}

function supplierProfileScore(supplier: SupplierProfileCandidate) {
  let score = supplier.confirmedByHuman ? 100 : 0;
  if (supplier.companyName?.trim()) score += 15;
  if (supplier.contactEmail?.trim()) score += 12;
  if (supplier.contactName?.trim()) score += 10;
  if (supplier.address?.trim()) score += 4;
  if (supplier.foundedYear) score += 3;
  if (supplier.companyRevenue) score += 3;
  score += (supplier.preferredItemCount ?? 0) * 8;
  score += (supplier.supplierOfferCount ?? 0) * 6;
  score += (supplier.purchaseOrderCount ?? 0) * 5;
  score += (supplier.invoiceCount ?? 0) * 5;
  score += (supplier.purchaseRequestCount ?? 0) * 3;
  score += (supplier.emailImportCount ?? 0);
  score += Math.min(cleanConfirmedSupplierOptionName(supplier).length, 40) / 10;
  return score;
}

export async function getItemSupplierEntries(): Promise<ItemSupplierEntry[]> {
  const items = await prisma.item.findMany({
    where: { lifecycleStatus: { not: "OBSOLETE" } },
    include: { preferredSupplier: true },
    orderBy: [{ category: "asc" }, { sku: "asc" }]
  });

  return items.map((item) => {
    const unitPrice = item.estimatedUnitCost === null ? null : Number(item.estimatedUnitCost);
    const currency = item.costCurrency.trim().toUpperCase() || "USD";
    return {
      itemId: item.id,
      sku: item.sku,
      description: item.description,
      category: item.category,
      useGroupOverride: item.useGroupOverride,
      cleanItemType: cleanItemType(item.category),
      supplierId: item.preferredSupplierId ?? "",
      supplierName: item.preferredSupplier?.name ?? "Unassigned",
      supplierSku: item.supplierSku ?? "",
      unitPriceUsd: currency === "USD" && Number.isFinite(unitPrice) ? unitPrice : null,
      costConfidence: item.costConfidence,
      costSourceRef: item.costSourceRef ?? "",
      contactName: item.preferredSupplier?.contactName ?? "",
      contactEmail: item.preferredSupplier?.contactEmail ?? "",
      companyName: item.preferredSupplier?.companyName ?? item.preferredSupplier?.name ?? ""
    };
  });
}

export async function updateItemSupplierEntry(input: {
  itemId: string;
  preferredSupplierId?: string;
  customSupplierName?: string;
  supplierSku?: string;
  estimatedUnitCost?: number;
  costConfidence?: CostConfidence;
  costSourceRef?: string;
  actorId: string;
  actorType?: "USER" | "AGENT";
}) {
  return prisma.$transaction(async (tx) => {
    const preferredSupplierId = await resolveSupplierSelection({
      preferredSupplierId: input.preferredSupplierId,
      customSupplierName: input.customSupplierName,
      actorId: input.actorId,
      actorType: input.actorType,
      client: tx
    });

    const item = await tx.item.update({
      where: { id: input.itemId },
      data: {
        preferredSupplierId,
        supplierSku: blankToNull(input.supplierSku),
        estimatedUnitCost: input.estimatedUnitCost === undefined ? null : new Prisma.Decimal(input.estimatedUnitCost),
        costCurrency: "USD",
        costConfidence: input.costConfidence ?? CostConfidence.UNKNOWN,
        costSourceRef: blankToNull(input.costSourceRef)
      }
    });

    await writeAuditLog({
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      action: "UPDATE_ITEM_SUPPLIER_ENTRY",
      entityType: "Item",
      entityId: item.id,
      payload: {
        preferredSupplierId: item.preferredSupplierId,
        customSupplierName: normalizeCustomSupplierName(input.customSupplierName),
        supplierSku: item.supplierSku,
        estimatedUnitCost: item.estimatedUnitCost?.toString() ?? null,
        costCurrency: item.costCurrency,
        costConfidence: item.costConfidence,
        costSourceRef: item.costSourceRef
      }
    }, tx);

    return item;
  });
}

export async function resolveSupplierSelection(input: {
  preferredSupplierId?: string | null;
  customSupplierName?: string | null;
  actorId: string;
  actorType?: "USER" | "AGENT";
  client?: SupplierWriteClient;
}) {
  const customSupplierName = normalizeCustomSupplierName(input.customSupplierName);
  if (customSupplierName) {
    const supplier = await getOrCreateCustomSupplier({
      name: customSupplierName,
      actorId: input.actorId,
      actorType: input.actorType,
      client: input.client
    });
    return supplier.id;
  }

  return blankToNull(input.preferredSupplierId ?? undefined);
}

async function getOrCreateCustomSupplier(input: {
  name: string;
  actorId: string;
  actorType?: "USER" | "AGENT";
  client?: SupplierWriteClient;
}) {
  const client = input.client ?? prisma;
  const name = normalizeCustomSupplierName(input.name);
  if (!isValidSupplierIdentityName(name)) {
    throw new Error("Enter a specific supplier name, not an email heading, tracking note, UI label, or generic supplier label.");
  }

  const canonicalName = canonicalSupplierIdentityKey(name);
  const possibleExisting = await client.supplier.findMany({
    select: { id: true, name: true, companyName: true, archivedAt: true }
  });
  const existing = possibleExisting.find((supplier) =>
    canonicalSupplierIdentityKey(supplier.companyName || supplier.name) === canonicalName
      || canonicalSupplierIdentityKey(supplier.name) === canonicalName
  );
  if (existing) {
    if (existing.archivedAt) {
      throw new Error(`Supplier "${existing.name}" is archived. Unarchive it from Suppliers before assigning it again.`);
    }
    return existing;
  }

  const supplier = await client.supplier.create({
    data: {
      name,
      companyName: name,
      confirmedByHuman: true,
      moq: 1,
      leadTimeDays: 0,
      shippingCost: 0,
      reliabilityScore: 0
    }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "CREATE_CUSTOM_SUPPLIER",
    entityType: "Supplier",
    entityId: supplier.id,
    payload: {
      supplierName: supplier.name,
      note: "Created from a human-entered custom supplier field. No inventory quantity was changed."
    }
  }, client);

  return supplier;
}

export async function updateSupplierContactProfile(input: {
  supplierId: string;
  companyName?: string;
  contactEmail?: string;
  contactName?: string;
  companyRevenue?: number;
  foundedYear?: number;
  address?: string;
  confirmedByHuman?: boolean;
  actorId: string;
  actorType?: "USER" | "AGENT";
}) {
  const supplier = await prisma.supplier.update({
    where: { id: input.supplierId },
    data: {
      companyName: blankToNull(input.companyName),
      contactEmail: blankToNull(input.contactEmail),
      contactName: blankToNull(input.contactName),
      companyRevenue: input.companyRevenue === undefined ? null : new Prisma.Decimal(input.companyRevenue),
      foundedYear: input.foundedYear ?? null,
      address: blankToNull(input.address),
      confirmedByHuman: input.confirmedByHuman ?? false
    }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "UPDATE_SUPPLIER_CONTACT_PROFILE",
    entityType: "Supplier",
    entityId: supplier.id,
    payload: {
      companyName: supplier.companyName,
      contactEmail: supplier.contactEmail,
      contactName: supplier.contactName,
      companyRevenue: supplier.companyRevenue?.toString() ?? null,
      foundedYear: supplier.foundedYear,
      address: supplier.address,
      confirmedByHuman: supplier.confirmedByHuman
    }
  });

  return supplier;
}

export async function archiveSupplierProfile(input: {
  supplierId: string;
  actorId: string;
  actorType?: "USER" | "AGENT";
  reason?: string;
}) {
  const reason = input.reason?.trim() || "Archived by operator";
  const supplier = await prisma.supplier.update({
    where: { id: input.supplierId },
    data: {
      archivedAt: new Date(),
      archivedBy: input.actorId,
      archiveReason: reason
    }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "ARCHIVE_SUPPLIER",
    entityType: "Supplier",
    entityId: supplier.id,
    payload: {
      supplierName: supplier.name,
      reason,
      note: "Supplier hidden from active supplier lists. Historical purchasing and email records are preserved."
    }
  });

  return supplier;
}

export async function unarchiveSupplierProfile(input: {
  supplierId: string;
  actorId: string;
  actorType?: "USER" | "AGENT";
}) {
  const supplier = await prisma.supplier.update({
    where: { id: input.supplierId },
    data: {
      archivedAt: null,
      archivedBy: null,
      archiveReason: null
    }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "UNARCHIVE_SUPPLIER",
    entityType: "Supplier",
    entityId: supplier.id,
    payload: {
      supplierName: supplier.name,
      note: "Supplier restored to active supplier lists and eligible confirmed dropdown options."
    }
  });

  return supplier;
}

export async function deleteArchivedSupplier(input: {
  supplierId: string;
  actorId: string;
  actorType?: "USER" | "AGENT";
}) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      include: {
        _count: {
          select: {
            preferredFor: true,
            offers: true,
            purchaseRequests: true,
            purchaseOrders: true,
            invoices: true,
            emailOrderImports: true
          }
        }
      }
    });

    if (!supplier) throw new Error("Supplier does not exist.");
    if (!supplier.archivedAt) throw new Error("Archive the supplier before deleting it.");

    const historicalReferenceCount = supplier._count.purchaseRequests
      + supplier._count.purchaseOrders
      + supplier._count.invoices
      + supplier._count.emailOrderImports;
    if (historicalReferenceCount > 0) {
      throw new Error("Archived supplier has historical purchasing or email records and cannot be hard-deleted. Keep it archived instead.");
    }

    await tx.item.updateMany({
      where: { preferredSupplierId: supplier.id },
      data: { preferredSupplierId: null }
    });
    await tx.supplierOffer.deleteMany({ where: { supplierId: supplier.id } });
    await tx.supplier.delete({ where: { id: supplier.id } });

    await writeAuditLog({
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      action: "DELETE_ARCHIVED_SUPPLIER",
      entityType: "Supplier",
      entityId: supplier.id,
      payload: {
        supplierName: supplier.name,
        archivedAt: supplier.archivedAt.toISOString(),
        archivedBy: supplier.archivedBy,
        archiveReason: supplier.archiveReason,
        clearedPreferredItemCount: supplier._count.preferredFor,
        deletedOfferCount: supplier._count.offers
      }
    }, tx);

    return supplier;
  });
}

export function cleanItemType(category: string) {
  return category
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function canonicalSupplierIdentityKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:co|company|ltd|limited|inc|incorporated|llc|factory|store|official|trading|technology|technologies)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidSupplierIdentityName(value: string) {
  const raw = value.trim();
  if (/\b(?:tracking number|logistics company|ship out your order|order soon|view order details|initial payment|trade assurance|each once)\b/i.test(raw)) return false;
  const cleaned = cleanConfirmedSupplierOptionName({ name: value });
  const canonical = canonicalSupplierIdentityKey(cleaned);
  if (cleaned.length < 2 || canonical.length < 2) return false;
  if (looksLikeEmailHeading(cleaned) || looksLikeImportedEmailSentence(cleaned) || looksLikeGenericImportedSupplier(cleaned)) return false;
  if (looksLikeImportedSupplierJunk(cleaned)) return false;
  if (/^https?:\/\//i.test(cleaned) || /^\//.test(cleaned)) return false;
  if (cleaned.length > 90 && !/\b(?:co\.?|ltd\.?|limited|factory|electronics|technology|textile|trading|industrial|manufactur)/i.test(cleaned)) return false;
  if (/\b(?:tracking number|logistics company|ship out your order|order soon|view order details|initial payment|trade assurance|each once)\b/i.test(cleaned)) return false;
  return true;
}

function looksLikeEmailHeading(value: string) {
  const cleaned = value.trim();
  return /^(?:subject|from|to|cc|bcc|date|message-id|reply-to)\s*:/i.test(cleaned)
    || /^your\s+(?:alibaba\s+)?(?:order|payment|invoice|shipment)/i.test(cleaned)
    || /^order\s+(?:confirmation|summary|invoice|notice)/i.test(cleaned);
}

function looksLikeImportedEmailSentence(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  return /\bhas received your initial payment\b/.test(normalized)
    || /\bview order details total\b/.test(normalized)
    || /\bhas drafted a trade assurance contract\b/.test(normalized)
    || /\bsend your initial payment by t\/t\b/.test(normalized)
    || /\bdifferent payment methods have different fee rates\b/.test(normalized);
}

function looksLikeGenericImportedSupplier(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized === "alibaba"
    || normalized === "alibaba supplier"
    || normalized === "supplier"
    || normalized === "unknown supplier"
    || normalized === "order email"
    || normalized === "confirmed order"
    || normalized === "order notification"
    || normalized === "tel"
    || normalized === "phone";
}

function looksLikeImportedSupplierJunk(value: string) {
  return importedSupplierJunkReason(value) !== null;
}

function importedSupplierJunkReason(value: string) {
  const cleaned = value.trim();
  const normalized = cleaned.toLowerCase().replace(/\s+/g, " ");
  const compact = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!cleaned) return "blank supplier label";
  if (["alibaba", "alibaba supplier", "supplier", "unknown supplier", "order email", "confirmed order", "order notification", "tel", "phone"].includes(compact)) {
    return "generic imported supplier placeholder";
  }
  if (/^\/apps\/details\b/i.test(cleaned) || /\bcom\.alibaba\./i.test(cleaned)) return "Alibaba app/deep-link URL captured as supplier";
  if (["details", "help contact", "help and contact", "send order request", "to ship", "track order", "message center", "each once"].includes(compact)) {
    return "Alibaba UI/navigation label captured as supplier";
  }
  if (/\binternational tracking number\b/.test(normalized) || /\blogistics company provides it\b/.test(normalized)) return "tracking-message sentence captured as supplier";
  if (/\bwill ship out your order soon\b/.test(normalized)) return "Alibaba shipment-message sentence captured as supplier";
  if (/\bhas received your initial payment\b/.test(normalized)) return "Alibaba payment sentence captured as supplier";
  if (/\btrade assurance contract\b/.test(normalized)) return "Alibaba Trade Assurance sentence captured as supplier";
  if (/\bview order details total\b/.test(normalized)) return "Alibaba order-details sentence captured as supplier";
  if (/^alibaba\s+com\s+singapore\s+e\s+commerce\s+private\s+limited\b/.test(compact)) return "Alibaba platform/legal entity captured instead of supplier";
  return null;
}

function looksLikeTestOrUselessSupplier(value: string) {
  const cleaned = value.trim();
  const normalized = cleaned.toLowerCase().replace(/\s+/g, " ");
  return /^test[-\s_]/i.test(cleaned)
    || /^order\s+test[-\s_]/i.test(cleaned)
    || /^supplier order\s+test[-\s_]/i.test(cleaned)
    || /\btest-email-archive\b/i.test(cleaned)
    || /^[a-z0-9_-]{48,}$/i.test(cleaned)
    || /\buseless\b/.test(normalized);
}

function normalizeCustomSupplierName(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function blankToNull(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
