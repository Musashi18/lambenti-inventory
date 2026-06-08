"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { archiveItem, createItem, unarchiveItem, updateItem } from "@/modules/items/service";
import { parseItemFormData } from "@/modules/items/form";
import { importItemsFromCsv } from "@/modules/items/import-export";
import { requirePermission } from "@/modules/auth/permissions";
import { revalidateWorkspace } from "@/app/revalidate-workspace";

export type ItemActionState = {
  ok: boolean;
  message: string;
};

const initialItemActionState: ItemActionState = { ok: false, message: "" };

async function getStorageLocationId(formData: FormData) {
  const value = formData.get("storageLocationId");
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  const fallback =
    (await prisma.storageLocation.findFirst({
      where: {
        OR: [{ code: { contains: "DEFAULT" } }, { name: { contains: "Default" } }, { name: { contains: "default" } }]
      },
      orderBy: [{ code: "asc" }, { createdAt: "asc" }],
      select: { id: true }
    })) ??
    (await prisma.storageLocation.findFirst({
      orderBy: [{ code: "asc" }, { createdAt: "asc" }],
      select: { id: true }
    }));
  if (!fallback) {
    throw new Error("A default internal storage location is required before creating items.");
  }
  return fallback.id;
}

function itemActionMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return "That SKU already exists. Use a unique internal SKU, or edit the existing item instead.";
    }
    if (error.code === "P2003") {
      return "The selected supplier or storage location no longer exists. Refresh the page and try again.";
    }
  }

  if (error instanceof Error) {
    if (error.name === "ZodError") return "Some item fields are invalid. Check SKU, description, quantities, currency, and cost fields.";
    return error.message;
  }

  return "Item save failed. Check the fields and try again.";
}

export async function createItemFormAction(_previous: ItemActionState, formData: FormData): Promise<ItemActionState> {
  try {
    const parsed = parseItemFormData(formData);
    const actor = await requirePermission("item:edit");
    const item = await createItem({
      ...parsed,
      storageLocationId: await getStorageLocationId(formData),
      actorId: actor.id
    });

    revalidateWorkspace();
    return { ok: true, message: `Created item ${item.sku}. Related dashboards have been refreshed.` };
  } catch (error) {
    return { ok: false, message: itemActionMessage(error) };
  }
}

export async function createItemAction(formData: FormData) {
  const result = await createItemFormAction(initialItemActionState, formData);
  if (!result.ok) throw new Error(result.message);
}

export async function updateItemFormAction(_previous: ItemActionState, formData: FormData): Promise<ItemActionState> {
  try {
    const itemId = formData.get("itemId");
    if (typeof itemId !== "string" || itemId.trim() === "") {
      throw new Error("Missing item id for update.");
    }

    const parsed = parseItemFormData(formData);
    const actor = await requirePermission("item:edit");
    const item = await updateItem({
      id: itemId,
      ...parsed,
      actorId: actor.id
    });

    revalidateWorkspace();
    return { ok: true, message: `Updated item ${item.sku}. Related dashboards have been refreshed.` };
  } catch (error) {
    return { ok: false, message: itemActionMessage(error) };
  }
}

export async function updateItemAction(formData: FormData) {
  const result = await updateItemFormAction(initialItemActionState, formData);
  if (!result.ok) throw new Error(result.message);
}

export async function archiveItemAction(formData: FormData) {
  const result = await archiveItemFormAction(initialItemActionState, formData);
  if (!result.ok) throw new Error(result.message);
}

export async function archiveItemFormAction(_previous: ItemActionState, formData: FormData): Promise<ItemActionState> {
  const itemId = formData.get("itemId");
  try {
    if (typeof itemId !== "string" || itemId.trim() === "") {
      throw new Error("Missing item id for archive.");
    }

    const actor = await requirePermission("item:edit");
    const item = await archiveItem({ id: itemId, actorId: actor.id });
    revalidateWorkspace();
    return { ok: true, message: `Archived item ${item.sku}. It remains in historical records as OBSOLETE.` };
  } catch (error) {
    return { ok: false, message: itemActionMessage(error) };
  }
}

export async function unarchiveItemAction(formData: FormData) {
  const result = await unarchiveItemFormAction(initialItemActionState, formData);
  if (!result.ok) throw new Error(result.message);
}

export async function unarchiveItemFormAction(_previous: ItemActionState, formData: FormData): Promise<ItemActionState> {
  const itemId = formData.get("itemId");
  try {
    if (typeof itemId !== "string" || itemId.trim() === "") {
      throw new Error("Missing item id for unarchive.");
    }

    const actor = await requirePermission("item:edit");
    const item = await unarchiveItem({ id: itemId, actorId: actor.id });
    revalidateWorkspace();
    return { ok: true, message: `Unarchived item ${item.sku}. It is ACTIVE again.` };
  } catch (error) {
    return { ok: false, message: itemActionMessage(error) };
  }
}

export async function importItemsCsvFormAction(_previous: ItemActionState, formData: FormData): Promise<ItemActionState> {
  const csv = formData.get("csv");
  if (typeof csv !== "string" || csv.trim() === "") {
    return { ok: false, message: "Paste item CSV before importing." };
  }

  try {
    const actor = await requirePermission("item:edit");
    const result = await importItemsFromCsv({
      csv,
      storageLocationId: await getStorageLocationId(formData),
      actorId: actor.id
    });

    if (!result.valid) {
      return {
        ok: false,
        message: `CSV import failed: ${result.errors.map((error) => `row ${error.row} ${error.field}: ${error.message}`).join("; ")}`
      };
    }

    revalidateWorkspace();
    return {
      ok: true,
      message: `Imported ${result.createdCount} item${result.createdCount === 1 ? "" : "s"}. Related dashboards have been refreshed.`
    };
  } catch (error) {
    return { ok: false, message: itemActionMessage(error) };
  }
}
