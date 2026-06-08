"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/auth/permissions";
import { createDraftPurchaseRequestFromFinding, ignoreAutomationFinding, runInventoryAnomalyScan, runStockReorderScan } from "@/modules/automation/service";

export async function runStockReorderScanAction() {
  const actor = await requirePermission("automation:run");
  await runStockReorderScan({ actorType: actor.actorType, actorId: actor.id });
  revalidatePath("/");
  revalidatePath("/automation");
}

export async function runInventoryAnomalyScanAction() {
  const actor = await requirePermission("automation:run");
  await runInventoryAnomalyScan({ actorType: actor.actorType, actorId: actor.id });
  revalidatePath("/");
  revalidatePath("/automation");
}

export async function createDraftPurchaseRequestFromFindingAction(formData: FormData) {
  const findingId = formData.get("findingId");
  if (typeof findingId !== "string" || findingId.trim() === "") {
    throw new Error("Missing automation finding id.");
  }

  const actor = await requirePermission("purchaseRequest:draft");
  await createDraftPurchaseRequestFromFinding({ findingId, actorType: actor.actorType, actorId: actor.id });
  revalidatePath("/");
  revalidatePath("/automation");
  revalidatePath("/purchasing/requests");
}

export async function ignoreAutomationFindingAction(formData: FormData) {
  const findingId = formData.get("findingId");
  if (typeof findingId !== "string" || findingId.trim() === "") {
    throw new Error("Missing automation finding id.");
  }

  const actor = await requirePermission("automation:run");
  await ignoreAutomationFinding({ findingId, actorType: actor.actorType, actorId: actor.id });
  revalidatePath("/");
  revalidatePath("/automation");
}
