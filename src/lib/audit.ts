import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function writeAuditLog(input: {
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
}) {
  return prisma.auditLog.create({
    data: {
      ...input,
      payload: toJson(input.payload)
    }
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
