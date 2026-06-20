import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { installDefaultApPostingSetup } from "./gl";
import { summarizePostingGlSetup } from "./overview";

const TEST_PREFIX = "TEST-ACCOUNTING-GL-DEFAULT";
const actorId = `${TEST_PREFIX}-actor`;

async function cleanupTestData() {
  const accountIds = (await prisma.gLAccount.findMany({ where: { code: { startsWith: TEST_PREFIX } }, select: { id: true } })).map((account) => account.id);
  if (accountIds.length > 0) await prisma.gLAccountMapping.deleteMany({ where: { glAccountId: { in: accountIds } } });
  if (accountIds.length > 0) await prisma.gLAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

describe("default AP posting setup", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("installs required default GL mappings idempotently without posting journals", async () => {
    const first = await installDefaultApPostingSetup({ actorId, codePrefix: TEST_PREFIX });
    const second = await installDefaultApPostingSetup({ actorId, codePrefix: TEST_PREFIX });
    const mappings = await prisma.gLAccountMapping.findMany({
      where: { glAccount: { code: { startsWith: TEST_PREFIX } } },
      include: { glAccount: true },
      orderBy: { purpose: "asc" }
    });
    const setup = summarizePostingGlSetup(mappings);

    expect(first).toHaveLength(4);
    expect(first.every((result) => result.status === "created")).toBe(true);
    expect(second).toHaveLength(4);
    expect(second.every((result) => result.status === "kept")).toBe(true);
    expect(setup.readyForPosting).toBe(true);
    expect(setup.missingPurposes).toEqual([]);
    expect(await prisma.journalEntry.count({ where: { sourceReference: { startsWith: TEST_PREFIX } } })).toBe(0);
  });
});
