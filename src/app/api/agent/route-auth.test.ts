import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/agents/service", () => ({
  logAgentAction: vi.fn()
}));
vi.mock("@/modules/boms/service", () => ({
  getBomExplosion: vi.fn(async () => [{ id: "bom-1", parentItemId: "item-finished" }])
}));
vi.mock("@/modules/dashboard/service", () => ({
  getDashboardSummary: vi.fn(async () => ({
    shortages: [{ itemId: "item-short", sku: "TEST-SHORT", demand: 3, available: 0, shortage: 3 }]
  }))
}));
vi.mock("@/modules/suppliers/service", () => ({
  getSupplierComparison: vi.fn(async () => [{ itemSku: "TEST-SHORT", supplierName: "Supplier" }])
}));
vi.mock("@/modules/purchasing/service", () => ({
  createDraftPurchaseRequest: vi.fn(async () => ({ id: "draft-pr-1", status: "DRAFT", lines: [{ itemId: "item-short", quantity: 3 }] }))
}));

import { logAgentAction } from "@/modules/agents/service";
import { getBomExplosion } from "@/modules/boms/service";
import { getDashboardSummary } from "@/modules/dashboard/service";
import { getSupplierComparison } from "@/modules/suppliers/service";
import { createDraftPurchaseRequest } from "@/modules/purchasing/service";
import * as bomsRoute from "./boms/route";
import * as shortagesRoute from "./shortages/route";
import * as supplierOffersRoute from "./supplier-offers/route";
import * as purchaseRequestsRoute from "./purchase-requests/route";

const originalEnv = { ...process.env };

function request(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function callGet(handler: unknown, url: string, init?: RequestInit) {
  return (handler as (request: Request) => Promise<Response>)(request(url, init));
}

describe("agent API route auth contract", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.unstubAllEnvs();
  });

  it("fails closed for unauthenticated non-local production read APIs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LAMBENTI_AGENT_API_SECRET;

    const checks = [
      { route: bomsRoute, path: "/api/agent/boms" },
      { route: shortagesRoute, path: "/api/agent/shortages" },
      { route: supplierOffersRoute, path: "/api/agent/supplier-offers" }
    ];

    for (const check of checks) {
      const response = await callGet(check.route.GET, `https://inventory.lambenti.example${check.path}`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/agent auth/i) });
    }

    expect(getBomExplosion).not.toHaveBeenCalled();
    expect(getDashboardSummary).not.toHaveBeenCalled();
    expect(getSupplierComparison).not.toHaveBeenCalled();
    expect(logAgentAction).not.toHaveBeenCalled();
  });

  it("allows authenticated production read APIs and records the authenticated agent id in logs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LAMBENTI_AGENT_API_SECRET = "s";

    const response = await callGet(bomsRoute.GET, "https://inventory.lambenti.example/api/agent/boms", {
      headers: {
        authorization: "Bearer s",
        "x-lambenti-agent-id": "order-planner-agent"
      }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "bom-1", parentItemId: "item-finished" }]);
    expect(logAgentAction).toHaveBeenCalledWith(
      "READ_BOM",
      expect.objectContaining({ actorId: "order-planner-agent" }),
      expect.arrayContaining([expect.objectContaining({ id: "bom-1" })])
    );
  });

  it("fails closed for unauthenticated non-local production draft purchase requests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LAMBENTI_AGENT_API_SECRET;

    const response = await purchaseRequestsRoute.POST(request("https://inventory.lambenti.example/api/agent/purchase-requests", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-short", quantity: 3, rationale: "shortage", requestedBy: "agent" })
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/agent auth/i) });
    expect(createDraftPurchaseRequest).not.toHaveBeenCalled();
    expect(logAgentAction).not.toHaveBeenCalled();
  });

  it("fails closed for loopback-looking production draft purchase requests when local smoke auth is not explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LAMBENTI_ALLOW_LOCAL_PROD_AUTH;
    delete process.env.LAMBENTI_AGENT_API_SECRET;

    const response = await purchaseRequestsRoute.POST(request("http://127.0.0.1:5173/api/agent/purchase-requests", {
      method: "POST",
      headers: { host: "127.0.0.1:5173" },
      body: JSON.stringify({ itemId: "item-short", quantity: 3, rationale: "shortage", requestedBy: "agent" })
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/agent auth/i) });
    expect(createDraftPurchaseRequest).not.toHaveBeenCalled();
    expect(logAgentAction).not.toHaveBeenCalled();
  });

  it("returns structured JSON for invalid draft purchase request payloads instead of throwing", async () => {
    const response = await purchaseRequestsRoute.POST(request("http://127.0.0.1:5173/api/agent/purchase-requests", {
      method: "POST",
      body: JSON.stringify({ itemId: "item-short", quantity: -1, rationale: "", requestedBy: "agent" })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/invalid draft purchase request/i) });
    expect(createDraftPurchaseRequest).not.toHaveBeenCalled();
  });

  it("creates DRAFT purchase requests as the authenticated agent, not as a spoofed actor", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LAMBENTI_AGENT_API_SECRET = "s";

    const response = await purchaseRequestsRoute.POST(request("https://inventory.lambenti.example/api/agent/purchase-requests", {
      method: "POST",
      headers: {
        authorization: "Bearer s",
        "x-lambenti-agent-id": "stock-agent-7"
      },
      body: JSON.stringify({ itemId: "item-short", quantity: 3, rationale: "shortage", requestedBy: "spoofed-agent-name" })
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ status: "DRAFT" });
    expect(createDraftPurchaseRequest).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "item-short",
      quantity: 3,
      requestedBy: "spoofed-agent-name",
      actorType: "AGENT",
      actorId: "stock-agent-7"
    }));
    expect(logAgentAction).toHaveBeenCalledWith(
      "CREATE_DRAFT_PURCHASE_REQUEST",
      expect.objectContaining({ actorId: "stock-agent-7" }),
      expect.objectContaining({ status: "DRAFT" })
    );
  });

  it("does not expose mutation handlers on read-only agent APIs", () => {
    for (const route of [bomsRoute, shortagesRoute, supplierOffersRoute]) {
      expect("POST" in route).toBe(false);
      expect("PUT" in route).toBe(false);
      expect("DELETE" in route).toBe(false);
    }
  });
});
