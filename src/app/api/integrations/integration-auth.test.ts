import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/modules/email-imports/mailbox", () => ({
  syncAlibabaMailboxWithBackoff: vi.fn(async () => ({ configured: true, imported: 0, skipped: 0, errors: [] }))
}));
vi.mock("@/modules/alibaba-portal/import", () => ({
  importAlibabaPortalSnapshots: vi.fn(async () => ({ imported: 0, updated: 0, errors: [] }))
}));

import * as mailboxRoute from "./alibaba-email/sync/route";
import * as portalRoute from "./alibaba-portal/import/route";
import { importAlibabaPortalSnapshots } from "@/modules/alibaba-portal/import";

function nextRequest(url: string, init?: RequestInit) {
  return new NextRequest(new Request(url, init));
}

describe("integration route production authorization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed for mailbox sync in production when the sync secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_EMAIL_SYNC_SECRET", "");

    const response = await mailboxRoute.GET(nextRequest("http://127.0.0.1:5173/api/integrations/alibaba-email/sync"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/not configured/i) });
  });

  it("allows mailbox sync in local development without a secret", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LAMBENTI_EMAIL_SYNC_SECRET", "");

    const response = await mailboxRoute.GET(nextRequest("http://127.0.0.1:5173/api/integrations/alibaba-email/sync"));

    expect(response.status).toBe(200);
  });

  it("rejects mailbox sync query-string secrets and requires bearer auth", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_EMAIL_SYNC_SECRET", "s");

    const response = await mailboxRoute.GET(nextRequest("http://127.0.0.1:5173/api/integrations/alibaba-email/sync?secret=s"));

    expect(response.status).toBe(401);
  });

  it("fails closed for Alibaba portal import in production when the agent secret is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALIBABA_AGENT_SECRET", "");
    vi.stubEnv("LAMBENTI_EMAIL_SYNC_SECRET", "");

    const response = await portalRoute.POST(nextRequest("http://127.0.0.1:5173/api/integrations/alibaba-portal/import", {
      method: "POST",
      body: JSON.stringify({ snapshots: [{ sourceUrl: "https://example.test/order", text: "This is a long enough captured order snapshot for validation." }] }),
      headers: { "content-type": "application/json" }
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/not configured/i) });
  });

  it("ignores spoofed portal import actor ids from the request body", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALIBABA_AGENT_SECRET", "s");

    const response = await portalRoute.POST(nextRequest("http://127.0.0.1:5173/api/integrations/alibaba-portal/import", {
      method: "POST",
      body: JSON.stringify({
        actorId: "spoofed-human-admin",
        snapshots: [{ sourceUrl: "https://example.test/order", text: "This is a long enough captured order snapshot for validation." }]
      }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer s",
        "x-lambenti-agent-id": "authenticated-portal-agent"
      }
    }));

    expect(response.status).toBe(200);
    expect(importAlibabaPortalSnapshots).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "authenticated-portal-agent"
    }));
  });

  it("rejects Alibaba portal query-string secrets and requires bearer auth", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAMBENTI_ALIBABA_AGENT_SECRET", "s");

    const response = await portalRoute.POST(nextRequest("http://127.0.0.1:5173/api/integrations/alibaba-portal/import?secret=s", {
      method: "POST",
      body: JSON.stringify({ snapshots: [{ sourceUrl: "https://example.test/order", text: "This is a long enough captured order snapshot for validation." }] }),
      headers: { "content-type": "application/json" }
    }));

    expect(response.status).toBe(401);
  });
});
