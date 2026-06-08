"use server";

import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { approvePurchaseRequest, rejectPurchaseRequest } from "@/modules/purchasing/requests";

export async function approvePurchaseRequestAction(formData: FormData) {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId.trim()) throw new Error("Missing purchase request id.");

  const actor = await requirePermission("purchaseRequest:approve");
  await approvePurchaseRequest({
    requestId,
    actor,
    comment: optionalString(formData.get("comment"))
  });

  revalidateWorkspace();
}

export async function rejectPurchaseRequestAction(formData: FormData) {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId.trim()) throw new Error("Missing purchase request id.");

  const actor = await requirePermission("purchaseRequest:approve");
  await rejectPurchaseRequest({
    requestId,
    actor,
    comment: optionalString(formData.get("comment"))
  });

  revalidateWorkspace();
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
