"use server";

import { applyAlibabaEmailOrderImport, archiveEmailOrderImport, deleteArchivedEmailOrderImport, importAlibabaEmailOrder, reassessRecentEmailOrderImports, unarchiveEmailOrderImport, updateEmailOrderImportLine } from "@/modules/email-imports/alibaba-email";
import { syncAlibabaMailboxWithBackoff } from "@/modules/email-imports/mailbox";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";

type EmailImportActionState = {
  success: boolean;
  message: string;
};

export async function importAlibabaEmailAction(formData: FormData) {
  const rawText = formData.get("rawText");
  const autoApply = formData.get("autoApply") === "on";

  if (typeof rawText !== "string" || rawText.trim().length < 20) {
    throw new Error("Paste the Alibaba/order email text before importing.");
  }

  const actor = await requirePermission("integration:mutate");
  await importAlibabaEmailOrder({
    rawText,
    autoApply,
    actorId: actor.id,
    source: inferManualOrderEmailSource(rawText)
  });

  revalidateWorkspace();
}

export async function applyAlibabaEmailImportAction(formData: FormData) {
  const importId = formData.get("importId");
  if (typeof importId !== "string" || importId.trim() === "") {
    throw new Error("Missing email import id.");
  }

  const actor = await requirePermission("integration:mutate");
  await applyAlibabaEmailOrderImport(importId, actor.id);
  revalidateWorkspace();
}

export async function updateAlibabaEmailLineAction(formData: FormData) {
  const lineId = readString(formData, "lineId");
  const rawDescription = readString(formData, "rawDescription");
  const quantity = Number(readString(formData, "quantity"));
  const unitPriceText = readString(formData, "unitPrice");
  const unitPrice = unitPriceText ? Number(unitPriceText) : undefined;
  const currency = readString(formData, "currency") || "USD";
  const matchedItemId = readString(formData, "matchedItemId") || null;

  if (!lineId || rawDescription.trim().length < 2 || !Number.isInteger(quantity) || quantity <= 0 || (unitPrice !== undefined && !Number.isFinite(unitPrice))) {
    throw new Error("Fix the edited email line fields before saving.");
  }

  const actor = await requirePermission("integration:mutate");
  await updateEmailOrderImportLine({
    lineId,
    rawDescription,
    quantity,
    unitPrice,
    currency,
    matchedItemId,
    actorId: actor.id
  });
  revalidateWorkspace();
}

export async function archiveAlibabaEmailImportAction(formData: FormData) {
  const importId = formData.get("importId");
  if (typeof importId !== "string" || importId.trim() === "") {
    throw new Error("Missing email import id.");
  }

  const actor = await requirePermission("integration:mutate");
  await archiveEmailOrderImport(importId, actor.id, "Ignored from Order Email Agent");
  revalidateWorkspace();
}

export async function unarchiveAlibabaEmailImportAction(formData: FormData): Promise<EmailImportActionState> {
  const importId = formData.get("importId");
  if (typeof importId !== "string" || importId.trim() === "") {
    return emailImportActionFailure("Missing email import id.");
  }

  try {
    const actor = await requirePermission("integration:mutate");
    await unarchiveEmailOrderImport(importId, actor.id);
    revalidateWorkspace();
    return { success: true, message: "Archived email import restored to the active review queue." };
  } catch (error) {
    return emailImportActionFailure(error);
  }
}

export async function deleteArchivedAlibabaEmailImportAction(formData: FormData): Promise<EmailImportActionState> {
  const importId = formData.get("importId");
  if (typeof importId !== "string" || importId.trim() === "") {
    return emailImportActionFailure("Missing email import id.");
  }

  try {
    const actor = await requirePermission("integration:mutate");
    await deleteArchivedEmailOrderImport(importId, actor.id);
    revalidateWorkspace();
    return { success: true, message: "Archived email import permanently deleted." };
  } catch (error) {
    return emailImportActionFailure(error);
  }
}

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function emailImportActionFailure(error: unknown): EmailImportActionState {
  return {
    success: false,
    message: error instanceof Error ? error.message : String(error)
  };
}

export async function syncAlibabaEmailMailboxAction() {
  const actor = await requirePermission("integration:mutate");
  const result = await syncAlibabaMailboxWithBackoff(actor.id);

  revalidateWorkspace();

  if (!result.configured) {
    throw new Error(result.errors[0] ?? "Mailbox is not configured.");
  }

  if (result.errors.length > 0 && result.fetchedMessages === 0) {
    throw new Error(`Mailbox sync failed: ${result.errors.join("; ")}`);
  }
}

export async function reassessRecentAlibabaEmailImportsAction() {
  const actor = await requirePermission("integration:mutate");
  const sync = await syncAlibabaMailboxWithBackoff(actor.id).catch((error) => ({
    configured: false,
    fetchedMessages: 0,
    imported: 0,
    duplicates: 0,
    errors: [error instanceof Error ? error.message : String(error)]
  }));
  const reassess = await reassessRecentEmailOrderImports(actor.id);
  revalidateWorkspace();
  return { ...reassess, sync };
}

function inferManualOrderEmailSource(rawText: string) {
  return looksLikeManualCsvOrderImport(rawText) ? "MANUAL_CSV_IMPORT" : "MANUAL_EMAIL";
}

function looksLikeManualCsvOrderImport(rawText: string) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => /\bsku\b/i.test(line)
    && /\b(?:description|product|item)\b/i.test(line)
    && /\b(?:qty|quantity)\b/i.test(line)
    && /[,|\t]/.test(line));
}
