import { Prisma, PurchaseRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";

const APPROVABLE_STATUSES = new Set<PurchaseRequestStatus>([
  PurchaseRequestStatus.DRAFT,
  PurchaseRequestStatus.PENDING_APPROVAL
]);
const REJECTABLE_STATUSES = new Set<PurchaseRequestStatus>([
  PurchaseRequestStatus.DRAFT,
  PurchaseRequestStatus.PENDING_APPROVAL
]);

type PurchaseRequestTransitionInput = {
  requestId: string;
  actor: AuthenticatedActor;
  comment?: string;
};

export async function approvePurchaseRequest(input: PurchaseRequestTransitionInput) {
  assertPermission(input.actor, "purchaseRequest:approve");
  return transitionPurchaseRequest(input, PurchaseRequestStatus.APPROVED, APPROVABLE_STATUSES, "APPROVE_PURCHASE_REQUEST");
}

export async function rejectPurchaseRequest(input: PurchaseRequestTransitionInput) {
  assertPermission(input.actor, "purchaseRequest:approve");
  return transitionPurchaseRequest(input, PurchaseRequestStatus.REJECTED, REJECTABLE_STATUSES, "REJECT_PURCHASE_REQUEST");
}

async function transitionPurchaseRequest(
  input: PurchaseRequestTransitionInput,
  nextStatus: PurchaseRequestStatus,
  allowedFrom: Set<PurchaseRequestStatus>,
  auditAction: string
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.purchaseRequest.findUniqueOrThrow({
      where: { id: input.requestId },
      select: { id: true, status: true }
    });

    if (!allowedFrom.has(current.status)) {
      throw new Error(`Cannot transition purchase request from ${current.status} to ${nextStatus}.`);
    }

    const request = await tx.purchaseRequest.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        approvedBy: input.actor.id,
        approvedAt: new Date()
      },
      include: { lines: true, supplier: true }
    });

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: auditAction,
      entityType: "PurchaseRequest",
      entityId: request.id,
      payload: {
        fromStatus: current.status,
        toStatus: nextStatus,
        comment: input.comment?.trim() || undefined
      }
    }, tx as Prisma.TransactionClient);

    return request;
  });
}
