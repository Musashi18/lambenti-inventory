"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export async function approvePurchaseRequestAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const request = await prisma.purchaseRequest.update({
    where: { id: requestId },
    data: {
      status: "APPROVED",
      approvedBy: "human-admin",
      approvedAt: new Date()
    }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: "human-admin",
    action: "APPROVE_PURCHASE_REQUEST",
    entityType: "PurchaseRequest",
    entityId: request.id,
    payload: { requestId }
  });

  revalidatePath("/purchasing/requests");
}

export async function rejectPurchaseRequestAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const request = await prisma.purchaseRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      approvedBy: "human-admin",
      approvedAt: new Date()
    }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: "human-admin",
    action: "REJECT_PURCHASE_REQUEST",
    entityType: "PurchaseRequest",
    entityId: request.id,
    payload: { requestId }
  });

  revalidatePath("/purchasing/requests");
}

