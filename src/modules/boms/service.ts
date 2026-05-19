import { prisma } from "@/lib/prisma";

export async function getBomExplosion() {
  return prisma.bOM.findMany({
    include: {
      parentItem: true,
      lines: {
        include: {
          componentItem: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
}

