"use server";

import { ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createItem } from "@/modules/items/service";

const createItemSchema = z.object({
  sku: z.string().min(1),
  manufacturerPartNo: z.string().optional(),
  supplierSku: z.string().optional(),
  description: z.string().min(1),
  category: z.nativeEnum(ItemCategory),
  unit: z.nativeEnum(Unit),
  reorderPoint: z.coerce.number().int().min(0),
  targetStock: z.coerce.number().int().min(0),
  leadTimeDays: z.coerce.number().int().min(0),
  preferredSupplierId: z.string().optional(),
  lifecycleStatus: z.nativeEnum(LifecycleStatus),
  storageLocation: z.string().min(1)
});

export async function createItemAction(formData: FormData) {
  const parsed = createItemSchema.parse(Object.fromEntries(formData.entries()));
  await createItem({
    ...parsed,
    actorId: "human-admin"
  });
  revalidatePath("/inventory/items");
}

