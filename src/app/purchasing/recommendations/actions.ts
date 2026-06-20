"use server";

import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { createDraftPurchaseRequest } from "@/modules/purchasing/service";

export async function createDraftPurchaseRequestFromRecommendationAction(formData: FormData) {
  const itemId = requiredString(formData.get("itemId"), "Missing item id.");
  const quantity = positiveInteger(formData.get("quantity"), "Recommended quantity must be a positive whole number.");
  const supplierId = optionalString(formData.get("supplierId"));
  const rationale = optionalString(formData.get("rationale"))
    ?? "Drafted from purchase recommendation queue after low-stock review.";

  const actor = await requirePermission("purchaseRequest:draft");
  const request = await createDraftPurchaseRequest({
    itemId,
    quantity,
    supplierId,
    rationale,
    requestedBy: actor.id,
    actorType: actor.actorType === "AGENT" ? "AGENT" : "USER",
    actorId: actor.id
  });

  revalidateWorkspace(["/purchasing/recommendations", "/purchasing/requests", "/dashboard"]);
  return { ok: true, message: `Draft purchase request ${request.id} created.` };
}

function requiredString(value: FormDataEntryValue | null, message: string) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value.trim();
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function positiveInteger(value: FormDataEntryValue | null, message: string) {
  const text = requiredString(value, message);
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(message);
  return parsed;
}
