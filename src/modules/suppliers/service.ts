import { prisma } from "@/lib/prisma";

export async function getSupplierComparison() {
  return prisma.supplierOffer.findMany({
    include: {
      supplier: true,
      item: true
    },
    orderBy: [{ item: { sku: "asc" } }, { leadTimeDays: "asc" }]
  });
}

