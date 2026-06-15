import { GLAccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

type GLResolverClient = Pick<typeof prisma, "gLAccountMapping" | "supplierInvoiceLine">;

export type GLAccountInput = {
  code: string;
  name: string;
  type: GLAccountType;
  active?: boolean;
  actorId: string;
};

export type GLMappingInput = {
  scopeType: "INVOICE_LINE" | "ITEM" | "SUPPLIER" | "ITEM_CATEGORY" | "DEFAULT" | string;
  scopeId?: string;
  purpose: string;
  glAccountId: string;
  priority?: number;
  active?: boolean;
  actorId: string;
};

export async function getChartOfAccounts() {
  const [accounts, mappings] = await Promise.all([
    prisma.gLAccount.findMany({ orderBy: [{ active: "desc" }, { code: "asc" }] }),
    prisma.gLAccountMapping.findMany({ include: { glAccount: true }, orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "desc" }] })
  ]);
  return { accounts, mappings };
}

export async function upsertGLAccount(input: GLAccountInput) {
  const code = input.code.trim().toUpperCase();
  const account = await prisma.gLAccount.upsert({
    where: { code },
    create: { code, name: input.name.trim(), type: input.type, active: input.active ?? true },
    update: { name: input.name.trim(), type: input.type, active: input.active ?? true }
  });
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UPSERT_GL_ACCOUNT",
    entityType: "GLAccount",
    entityId: account.id,
    payload: { code: account.code, name: account.name, type: account.type, active: account.active }
  });
  return account;
}

export async function upsertGLMapping(input: GLMappingInput) {
  const scopeType = input.scopeType.trim().toUpperCase();
  const purpose = input.purpose.trim().toUpperCase();
  const existing = await prisma.gLAccountMapping.findFirst({
    where: { scopeType, scopeId: input.scopeId ?? null, purpose, glAccountId: input.glAccountId }
  });
  const data = {
    scopeType,
    scopeId: input.scopeId ?? null,
    purpose,
    glAccountId: input.glAccountId,
    priority: input.priority ?? defaultPriorityForScope(scopeType),
    active: input.active ?? true,
    createdBy: input.actorId
  };
  const mapping = existing
    ? await prisma.gLAccountMapping.update({ where: { id: existing.id }, data })
    : await prisma.gLAccountMapping.create({ data });
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UPSERT_GL_ACCOUNT_MAPPING",
    entityType: "GLAccountMapping",
    entityId: mapping.id,
    payload: { scopeType, scopeId: input.scopeId, purpose, glAccountId: input.glAccountId, priority: mapping.priority, active: mapping.active }
  });
  return mapping;
}

export async function resolveInvoiceLineAccount(invoiceLineId: string, purpose = "INVENTORY_ASSET", client: GLResolverClient = prisma) {
  const line = await client.supplierInvoiceLine.findUniqueOrThrow({
    where: { id: invoiceLineId },
    include: {
      glAccount: true,
      item: true,
      invoice: { include: { supplier: true } }
    }
  });
  if (line.glAccount?.active) return line.glAccount;

  const normalizedPurpose = purpose.trim().toUpperCase();
  return resolveMappedAccount({
    purpose: normalizedPurpose,
    candidates: [
      { scopeType: "ITEM", scopeId: line.itemId ?? undefined },
      { scopeType: "SUPPLIER", scopeId: line.invoice.supplierId },
      { scopeType: "ITEM_CATEGORY", scopeId: line.item?.category },
      { scopeType: "DEFAULT", scopeId: undefined }
    ],
    client
  });
}

export async function resolveMappedAccount(input: {
  purpose: string;
  candidates: Array<{ scopeType: string; scopeId?: string | null }>;
  client?: GLResolverClient;
}) {
  const client = input.client ?? prisma;
  const normalizedPurpose = input.purpose.trim().toUpperCase();
  for (const candidate of input.candidates) {
    const mapping = await client.gLAccountMapping.findFirst({
      where: {
        active: true,
        purpose: normalizedPurpose,
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId ?? null,
        glAccount: { active: true }
      },
      include: { glAccount: true },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }]
    });
    if (mapping) return mapping.glAccount;
  }

  return null;
}

export async function resolveRequiredMappedAccount(input: {
  purpose: string;
  candidates?: Array<{ scopeType: string; scopeId?: string | null }>;
  client?: GLResolverClient;
}) {
  const account = await resolveMappedAccount({
    purpose: input.purpose,
    candidates: input.candidates ?? [{ scopeType: "DEFAULT", scopeId: undefined }],
    client: input.client
  });
  if (!account) {
    throw new Error(`GL mapping required for ${input.purpose.trim().toUpperCase()}. Configure an active mapping on /accounting/accounts before posting this journal.`);
  }
  return account;
}

function defaultPriorityForScope(scopeType: string) {
  if (scopeType === "INVOICE_LINE") return 10;
  if (scopeType === "ITEM") return 20;
  if (scopeType === "SUPPLIER") return 40;
  if (scopeType === "ITEM_CATEGORY") return 60;
  return 100;
}
