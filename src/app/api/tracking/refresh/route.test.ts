import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/tracking/service", () => ({
  getTrackingRefreshHeartbeat: vi.fn(async () => ({ lastCheckedAt: new Date("2026-06-17T20:00:00.000Z"), nextRefreshAt: new Date("2026-06-17T21:00:00.000Z") })),
  refreshActiveTrackingNumbers: vi.fn(async () => ({ scanned: 2, refreshed: 2, failed: 0, skipped: 0 })),
  refreshDueTrackingNumbers: vi.fn(async () => ({ scanned: 1, refreshed: 1, failed: 0, skipped: 0 })),
  refreshTrackingNumber: vi.fn(async () => ({ refreshStatus: "SUCCESS" }))
}));

import * as route from "./route";
import { refreshActiveTrackingNumbers, refreshDueTrackingNumbers } from "@/modules/tracking/service";

function postRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  }));
}

describe("tracking refresh API auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("allows loopback page auto-refresh in local production smoke and ignores spoofed body actor IDs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALLOW_LOCAL_PROD_AUTH", "true");
    vi.stubEnv("LAMBENTI_TRACKING_AGENT_SECRET", "configured-secret");
    vi.stubEnv("LAMBENTI_ALIBABA_AGENT_SECRET", "");
    vi.stubEnv("LAMBENTI_EMAIL_SYNC_SECRET", "");

    const response = await route.POST(postRequest("http://127.0.0.1:5173/api/tracking/refresh", {
      dueOnly: true,
      actorId: "spoofed-human-admin"
    }, {
      host: "127.0.0.1:5173",
      "x-lambenti-agent-id": "tracking-page-auto-refresh"
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refreshed: 1, failed: 0 });
    expect(refreshDueTrackingNumbers).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "tracking-page-auto-refresh"
    }));
  });

  it("defaults API refresh to all active tracking numbers unless dueOnly is explicitly true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALLOW_LOCAL_PROD_AUTH", "true");

    const response = await route.POST(postRequest("http://127.0.0.1:5173/api/tracking/refresh", {}, {
      host: "127.0.0.1:5173",
      "x-lambenti-agent-id": "tracking-api-default"
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scanned: 2, refreshed: 2, failed: 0 });
    expect(refreshActiveTrackingNumbers).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "tracking-api-default",
      limit: 100
    }));
    expect(refreshDueTrackingNumbers).not.toHaveBeenCalled();
  });

  it("fails closed for non-loopback production refresh when no secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALLOW_LOCAL_PROD_AUTH", "true");
    vi.stubEnv("LAMBENTI_TRACKING_AGENT_SECRET", "");
    vi.stubEnv("LAMBENTI_ALIBABA_AGENT_SECRET", "");
    vi.stubEnv("LAMBENTI_EMAIL_SYNC_SECRET", "");

    const response = await route.POST(postRequest("https://inventory.lambenti.test/api/tracking/refresh", { dueOnly: true }, {
      host: "inventory.lambenti.test"
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/agent auth is not configured/i) });
  });
});
