import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, LifecycleStatus, MovementType, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createStockMovement } from "@/modules/inventory/service";

vi.mock("@/modules/agents/service", () => ({
  logAgentAction: vi.fn()
}));

import { logAgentAction } from "@/modules/agents/service";
import * as stockRoute from "./route";

const TEST_PREFIX = "TEST-STOCK-API";

async function cleanupTestData() {
  const items = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  vi.clearAllMocks();
}

async function createFixture() {
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-LOC`, name: "Stock API test location" }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-ITEM`,
      description: "Stock API contract item",
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 2,
      targetStock: 8,
      leadTimeDays: 3,
      lifecycleStatus: LifecycleStatus.ACTIVE,
      storageLocationId: location.id
    }
  });
  const lot = await prisma.stockLot.create({
    data: {
      itemId: item.id,
      lotCode: `${TEST_PREFIX}-LOT`,
      receivedAt: new Date("2026-06-01T00:00:00.000Z"),
      unitCost: 1.23
    }
  });

  await createStockMovement({
    itemId: item.id,
    stockLotId: lot.id,
    movementType: MovementType.RECEIVE,
    quantity: 5,
    reason: "Stock API test receipt",
    reference: "PO-STOCK-API",
    actorId: `${TEST_PREFIX}-actor`
  });

  return item;
}

describe("/api/agent/stock contract", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    await cleanupTestData();
  });
  afterAll(async () => {
    process.env = originalEnv;
    await cleanupTestData();
  });

  it("returns derived stock summaries and logs a read-only agent action", async () => {
    const item = await createFixture();

    const response = await (stockRoute.GET as unknown as (request: Request) => Promise<Response>)(
      new Request("http://127.0.0.1:5173/api/agent/stock")
    );
    const body = await response.json();
    const row = body.find((summary: { itemId: string }) => summary.itemId === item.id);

    expect(response.status).toBe(200);
    expect(row).toMatchObject({
      itemId: item.id,
      sku: item.sku,
      reorderPoint: 2,
      targetStock: 8,
      onHand: 5,
      reserved: 0,
      available: 5
    });
    expect(logAgentAction).toHaveBeenCalledWith("READ_STOCK", expect.objectContaining({ actorId: "dev-agent" }), expect.arrayContaining([
      expect.objectContaining({ itemId: item.id, onHand: 5 })
    ]));
  });

  it("allows unauthenticated loopback agent reads during local production smoke only with the explicit local flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALLOW_LOCAL_PROD_AUTH", "true");
    delete process.env.LAMBENTI_AGENT_API_SECRET;
    delete process.env.LAMBENTI_APP_AUTH_SECRET;
    const item = await createFixture();

    const response = await (stockRoute.GET as unknown as (request: Request) => Promise<Response>)(
      new Request("http://127.0.0.1:5173/api/agent/stock", { headers: { host: "127.0.0.1:5173" } })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: item.id })]));
  });

  it("blocks loopback-looking production agent reads when the local smoke flag is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LAMBENTI_ALLOW_LOCAL_PROD_AUTH;
    delete process.env.LAMBENTI_AGENT_API_SECRET;
    delete process.env.LAMBENTI_APP_AUTH_SECRET;

    const response = await (stockRoute.GET as unknown as (request: Request) => Promise<Response>)(
      new Request("http://127.0.0.1:5173/api/agent/stock", { headers: { host: "127.0.0.1:5173" } })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/agent auth/i) });
  });

  it("blocks unauthenticated non-local agent reads in production when no agent secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LAMBENTI_AGENT_API_SECRET;
    delete process.env.LAMBENTI_APP_AUTH_SECRET;

    const response = await (stockRoute.GET as unknown as (request: Request) => Promise<Response>)(
      new Request("https://inventory.lambenti.example/api/agent/stock")
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/agent auth/i) });
  });

  it("allows authenticated production agent reads with a bearer token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LAMBENTI_AGENT_API_SECRET = "s";
    const item = await createFixture();

    const response = await (stockRoute.GET as unknown as (request: Request) => Promise<Response>)(
      new Request("http://127.0.0.1:5173/api/agent/stock", {
        headers: { authorization: "Bearer s" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: item.id })]));
  });

  it("does not export mutation handlers for agent stock changes", () => {
    expect("POST" in stockRoute).toBe(false);
    expect("PUT" in stockRoute).toBe(false);
    expect("DELETE" in stockRoute).toBe(false);
  });
});
