import { describe, expect, it } from "vitest";
import { authorizeAgentRequest, hasPermission, resolveActorFromHeaders } from "./permissions";

describe("auth permission model", () => {
  it("allows operations/admin humans to create stock movements but blocks agents and viewers", () => {
    expect(hasPermission({ id: "ops", role: "OPERATIONS", type: "HUMAN" }, "stockMovement:create")).toBe(true);
    expect(hasPermission({ id: "admin", role: "ADMIN", type: "HUMAN" }, "stockMovement:create")).toBe(true);
    expect(hasPermission({ id: "agent", role: "AGENT", type: "AGENT" }, "stockMovement:create")).toBe(false);
    expect(hasPermission({ id: "viewer", role: "VIEWER", type: "HUMAN" }, "stockMovement:create")).toBe(false);
  });

  it("prevents agents from approval and payment gates", () => {
    const agent = { id: "agent", role: "AGENT" as const, type: "AGENT" as const };
    expect(hasPermission(agent, "purchaseRequest:approve")).toBe(false);
    expect(hasPermission(agent, "purchaseOrder:create")).toBe(false);
    expect(hasPermission(agent, "invoice:approve")).toBe(false);
    expect(hasPermission(agent, "invoice:markPaid")).toBe(false);
    expect(hasPermission(agent, "purchaseRequest:draft")).toBe(true);
    expect(hasPermission(agent, "agentApi:read")).toBe(true);
  });

  it("keeps Atlas visible to human operators but out of the agent role", () => {
    expect(hasPermission({ id: "viewer", role: "VIEWER", type: "HUMAN" }, "atlas:view")).toBe(true);
    expect(hasPermission({ id: "ops", role: "OPERATIONS", type: "HUMAN" }, "atlas:view")).toBe(true);
    expect(hasPermission({ id: "agent", role: "AGENT", type: "AGENT" }, "atlas:view")).toBe(false);
  });

  it("fails closed in production when auth material is missing", () => {
    const actor = resolveActorFromHeaders(new Headers(), {
      nodeEnv: "production",
      appSecret: undefined,
      agentSecret: undefined
    });

    expect(actor.ok).toBe(false);
    if (!actor.ok) {
      expect(actor.status).toBe(503);
      expect(actor.message).toMatch(/auth/i);
    }
  });

  it("keeps local development convenient with a safe admin identity", () => {
    const actor = resolveActorFromHeaders(new Headers(), {
      nodeEnv: "development",
      devUserId: "local-operator",
      devUserRole: "OPERATIONS"
    });

    expect(actor).toMatchObject({
      ok: true,
      actor: { id: "local-operator", role: "OPERATIONS", type: "HUMAN" }
    });
  });

  it("allows local production app actions on loopback only when the explicit local flag is set", () => {
    const headers = new Headers({ host: "127.0.0.1:5173" });
    const actor = resolveActorFromHeaders(headers, {
      nodeEnv: "production",
      appSecret: undefined,
      allowLocalProductionAuth: "true",
      devUserId: "local-operator",
      devUserRole: "OPERATIONS"
    });

    expect(actor).toMatchObject({
      ok: true,
      actor: { id: "local-operator", role: "OPERATIONS", type: "HUMAN", actorType: "USER" }
    });
  });

  it("still fails closed for non-loopback production app actions when no secret is configured", () => {
    const headers = new Headers({ host: "inventory.lambenti.example" });
    const actor = resolveActorFromHeaders(headers, {
      nodeEnv: "production",
      appSecret: undefined,
      allowLocalProductionAuth: "true"
    });

    expect(actor.ok).toBe(false);
    if (!actor.ok) {
      expect(actor.status).toBe(503);
      expect(actor.message).toBe("Application auth is not configured for production.");
    }
  });

  it("does not trust spoofable loopback origin/forwarded-host headers when the primary host is non-local", () => {
    const actor = resolveActorFromHeaders(new Headers({
      host: "inventory.lambenti.example",
      origin: "http://127.0.0.1:5173",
      "x-forwarded-host": "127.0.0.1:5173"
    }), {
      nodeEnv: "production",
      appSecret: undefined,
      allowLocalProductionAuth: "true"
    });

    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.status).toBe(503);
  });

  it("rejects local production app auth when origin or forwarded host contradicts loopback", () => {
    for (const headers of [
      new Headers({ host: "127.0.0.1:5173", origin: "https://inventory.lambenti.example" }),
      new Headers({ host: "127.0.0.1:5173", "x-forwarded-host": "inventory.lambenti.example" })
    ]) {
      const actor = resolveActorFromHeaders(headers, {
        nodeEnv: "production",
        appSecret: undefined,
        allowLocalProductionAuth: "true"
      });

      expect(actor.ok).toBe(false);
      if (!actor.ok) expect(actor.status).toBe(503);
    }
  });

  it("allows loopback agent API reads during local production smoke only when the explicit local flag is set", () => {
    const request = new Request("http://127.0.0.1:5173/api/agent/stock", {
      headers: { host: "127.0.0.1:5173" }
    });

    const withoutFlag = authorizeAgentRequest(request, {
      nodeEnv: "production",
      agentSecret: undefined
    });
    expect(withoutFlag.ok).toBe(false);

    const withFlag = authorizeAgentRequest(request, {
      nodeEnv: "production",
      agentSecret: undefined,
      allowLocalProductionAuth: "true"
    });

    expect(withFlag).toMatchObject({
      ok: true,
      actor: { id: "dev-agent", role: "AGENT", type: "AGENT" }
    });
  });
});
