import { PrismaClient } from "@prisma/client";
import { parseAlibabaEmail, reassessRecentEmailOrderImports } from "../src/modules/email-imports/alibaba-email";

const prisma = new PrismaClient();

type StoredLine = {
  rawDescription: string;
  supplierSku: string | null;
  quantity: number;
  unitPrice: { toString(): string } | null;
  lineTotal: { toString(): string } | null;
  matchConfidence: string;
};

type StoredImport = {
  id: string;
  subject: string | null;
  externalOrderId: string | null;
  rawText: string;
  lines: StoredLine[];
};

type LineSnapshot = {
  rawDescription: string;
  supplierSku: string | null;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
};

function storedLineSnapshot(line: StoredLine): LineSnapshot {
  return {
    rawDescription: line.rawDescription,
    supplierSku: line.supplierSku ?? null,
    quantity: Number(line.quantity),
    unitPrice: line.unitPrice == null ? null : Number(line.unitPrice.toString()),
    lineTotal: line.lineTotal == null ? null : Number(line.lineTotal.toString())
  };
}

function parsedLineSnapshot(line: ReturnType<typeof parseAlibabaEmail>["lines"][number]): LineSnapshot {
  return {
    rawDescription: line.rawDescription,
    supplierSku: line.supplierSku ?? null,
    quantity: Number(line.quantity),
    unitPrice: line.unitPrice == null ? null : Number(line.unitPrice),
    lineTotal: line.lineTotal == null ? null : Number(line.lineTotal)
  };
}

function snapshot(imports: StoredImport[]) {
  return imports.map((orderImport) => {
    const parsed = parseAlibabaEmail(orderImport.rawText);
    const stored = [...orderImport.lines]
      .sort((a, b) => a.rawDescription.localeCompare(b.rawDescription))
      .map(storedLineSnapshot);
    const reparsed = parsed.lines
      .map(parsedLineSnapshot)
      .sort((a, b) => a.rawDescription.localeCompare(b.rawDescription));

    return {
      id: orderImport.id,
      subject: orderImport.subject,
      externalOrderId: orderImport.externalOrderId,
      storedLineCount: stored.length,
      reparsedLineCount: reparsed.length,
      hasManualLineEdits: orderImport.lines.some((line) => line.matchConfidence.startsWith("MANUAL")),
      changedByParser: JSON.stringify(stored) !== JSON.stringify(reparsed),
      stored,
      reparsed
    };
  });
}

async function main() {
  const where = { archivedAt: null, purchaseOrderId: null };
  const beforeImports = await prisma.emailOrderImport.findMany({
    where,
    include: { lines: true },
    orderBy: { createdAt: "desc" },
    take: 25
  });
  const beforeStockMovements = await prisma.stockMovement.count();
  const before = snapshot(beforeImports);

  const result = await reassessRecentEmailOrderImports("qa-verify-email-reassessment");

  const afterImports = await prisma.emailOrderImport.findMany({
    where,
    include: { lines: true },
    orderBy: { createdAt: "desc" },
    take: 25
  });
  const afterStockMovements = await prisma.stockMovement.count();
  const after = snapshot(afterImports);
  const latestAudit = await prisma.auditLog.findFirst({
    where: { action: "REASSESS_RECENT_EMAIL_ORDER_IMPORTS" },
    orderBy: { createdAt: "desc" }
  });

  const report = {
    activeUnappliedBefore: before.length,
    candidatesBefore: before
      .filter((item) => item.changedByParser)
      .map(({ id, subject, externalOrderId, storedLineCount, reparsedLineCount, hasManualLineEdits }) => ({
        id,
        subject,
        externalOrderId,
        storedLineCount,
        reparsedLineCount,
        hasManualLineEdits
      })),
    reassessResult: result,
    activeUnappliedAfter: after.length,
    remainingParserMismatchesAfter: after
      .filter((item) => item.changedByParser)
      .map(({ id, subject, externalOrderId, storedLineCount, reparsedLineCount, hasManualLineEdits }) => ({
        id,
        subject,
        externalOrderId,
        storedLineCount,
        reparsedLineCount,
        hasManualLineEdits
      })),
    stockMovementsBefore: beforeStockMovements,
    stockMovementsAfter: afterStockMovements,
    stockMovementsUnchanged: beforeStockMovements === afterStockMovements,
    latestAuditPayload: latestAudit?.payload ?? null
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.stockMovementsUnchanged) {
    throw new Error("Email reassessment changed stock movements; this must never receive physical stock.");
  }
  if (!latestAudit) {
    throw new Error("Email reassessment did not write the expected audit log.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
