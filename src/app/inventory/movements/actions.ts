"use server";

import { MovementType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createStockMovement } from "@/modules/inventory/service";

const movementSchema = z.object({
  itemId: z.string().min(1),
  movementType: z.nativeEnum(MovementType),
  quantity: z.coerce.number().int(),
  reason: z.string().min(1),
  reference: z.string().optional()
});

export async function createMovementAction(formData: FormData) {
  const parsed = movementSchema.parse(Object.fromEntries(formData.entries()));
  await createStockMovement({
    ...parsed,
    actorId: "human-admin"
  });
  revalidatePath("/inventory/movements");
  revalidatePath("/");
}

