"use server";

import { CostConfidence } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/modules/auth/permissions";
import { archiveSupplierProfile, deleteArchivedSupplier, unarchiveSupplierProfile, updateItemSupplierEntry, updateSupplierContactProfile } from "@/modules/suppliers/service";

const supplierContactSchema = z.object({
  supplierId: z.string().min(1),
  companyName: optionalString(),
  contactEmail: optionalString().refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email address."),
  contactName: optionalString(),
  companyRevenue: optionalNumber(),
  foundedYear: optionalInteger().refine((value) => value === undefined || (value >= 1800 && value <= new Date().getFullYear()), "Enter a realistic founded year."),
  address: optionalString(),
  confirmedByHuman: z.boolean()
});

const itemSupplierEntrySchema = z.object({
  itemId: z.string().min(1),
  preferredSupplierId: optionalString(),
  supplierSku: optionalString(),
  estimatedUnitCost: optionalNumber(),
  costConfidence: z.nativeEnum(CostConfidence),
  costSourceRef: optionalString()
});

const archiveSupplierSchema = z.object({
  supplierId: z.string().min(1),
  archiveReason: optionalString()
});

const deleteArchivedSupplierSchema = z.object({
  supplierId: z.string().min(1)
});

type SupplierActionState = {
  success: boolean;
  message: string;
};

export async function updateSupplierContactAction(formData: FormData) {
  const parsed = supplierContactSchema.safeParse({
    supplierId: getString(formData, "supplierId"),
    companyName: getString(formData, "companyName"),
    contactEmail: getString(formData, "contactEmail"),
    contactName: getString(formData, "contactName"),
    companyRevenue: getString(formData, "companyRevenue"),
    foundedYear: getString(formData, "foundedYear"),
    address: getString(formData, "address"),
    confirmedByHuman: formData.get("confirmedByHuman") === "on"
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const actor = await requirePermission("supplier:edit");
  await updateSupplierContactProfile({
    ...parsed.data,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
    actorId: actor.id
  });
  revalidatePath("/suppliers");
}

export async function updateItemSupplierEntryAction(formData: FormData) {
  const parsed = itemSupplierEntrySchema.safeParse({
    itemId: getString(formData, "itemId"),
    preferredSupplierId: getString(formData, "preferredSupplierId"),
    supplierSku: getString(formData, "supplierSku"),
    estimatedUnitCost: getString(formData, "estimatedUnitCost"),
    costConfidence: getString(formData, "costConfidence"),
    costSourceRef: getString(formData, "costSourceRef")
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const actor = await requirePermission("supplier:edit");
  await updateItemSupplierEntry({
    ...parsed.data,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
    actorId: actor.id
  });
  revalidatePath("/suppliers");
  revalidatePath("/inventory/items");
  revalidatePath("/inventory/valuation");
}

export async function archiveSupplierAction(formData: FormData) {
  const parsed = archiveSupplierSchema.safeParse({
    supplierId: getString(formData, "supplierId"),
    archiveReason: getString(formData, "archiveReason")
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const actor = await requirePermission("supplier:edit");
  await archiveSupplierProfile({
    supplierId: parsed.data.supplierId,
    reason: parsed.data.archiveReason,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
    actorId: actor.id
  });
  revalidatePath("/suppliers");
}

export async function unarchiveSupplierAction(formData: FormData): Promise<SupplierActionState> {
  const parsed = deleteArchivedSupplierSchema.safeParse({
    supplierId: getString(formData, "supplierId")
  });
  if (!parsed.success) {
    return supplierActionFailure(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  try {
    const actor = await requirePermission("supplier:edit");
    await unarchiveSupplierProfile({
      supplierId: parsed.data.supplierId,
      actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
      actorId: actor.id
    });
    revalidatePath("/suppliers");
    return { success: true, message: "Supplier unarchived and restored to active supplier lists." };
  } catch (error) {
    return supplierActionFailure(error);
  }
}

export async function deleteArchivedSupplierAction(formData: FormData): Promise<SupplierActionState> {
  const parsed = deleteArchivedSupplierSchema.safeParse({
    supplierId: getString(formData, "supplierId")
  });
  if (!parsed.success) {
    return supplierActionFailure(parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  try {
    const actor = await requirePermission("supplier:edit");
    await deleteArchivedSupplier({
      supplierId: parsed.data.supplierId,
      actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
      actorId: actor.id
    });
    revalidatePath("/suppliers");
    return { success: true, message: "Archived supplier permanently deleted." };
  } catch (error) {
    return supplierActionFailure(error);
  }
}

function supplierActionFailure(error: unknown): SupplierActionState {
  return {
    success: false,
    message: error instanceof Error ? error.message : String(error)
  };
}

function optionalString() {
  return z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, z.string().optional());
}

function optionalNumber() {
  return z.preprocess((value) => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }, z.number().nonnegative().optional());
}

function optionalInteger() {
  return z.preprocess((value) => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  }, z.number().int().optional());
}

function getString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
