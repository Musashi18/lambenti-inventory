import { AgentActionType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function logAgentAction(
  actionType: keyof typeof AgentActionType,
  payload: unknown,
  result: unknown
) {
  return prisma.agentAction.create({
    data: {
      actionType: AgentActionType[actionType],
      agentName: "external-agent",
      payload: toJson(payload),
      result: toJson(result)
    }
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
