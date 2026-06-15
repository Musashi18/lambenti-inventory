import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Tracking page source contract", () => {
  it("exposes manual tracking, tracking-service refresh, linked orders, and auto refresh controls without the Alibaba capture card", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const actionsSource = readFileSync(join(__dirname, "actions.ts"), "utf8");
    const autoRefreshSource = readFileSync(join(__dirname, "tracking-auto-refresh.tsx"), "utf8");

    expect(pageSource).toContain("Tracking workbench");
    expect(pageSource).toContain("Manual tracking drop box");
    expect(pageSource).not.toContain("Automatic Alibaba capture");
    expect(pageSource).not.toContain("Capture Alibaba tracking");
    expect(pageSource).not.toContain("captureAlibabaTrackingAction");
    expect(pageSource).toContain("Linked order");
    expect(pageSource).toContain("Tracking service connection");
    expect(pageSource).toContain("Recommended provider: Ship24");
    expect(pageSource).toContain("LAMBENTI_TRACKING_STATUS_AUTH_TOKEN");
    expect(pageSource).toContain("data-testid=\"tracking-row\"");
    expect(pageSource).toContain("Active tracking numbers");
    expect(pageSource).toContain("Delivered tracking history");
    expect(pageSource).toContain("Total ship time");
    expect(pageSource).toContain("Lead-time learning log");
    expect(pageSource).toContain("Reorder forecasting input");
    expect(pageSource).toContain("quantity ordered");
    expect(pageSource).toContain("getLeadTimeLog");
    expect(pageSource).toContain("dashboard.deliveredRows");
    expect(pageSource).toContain("refreshAllTrackingAction");
    expect(actionsSource).toContain("refreshAllTrackingAction");
    expect(autoRefreshSource).toContain("/api/tracking/refresh");
    expect(autoRefreshSource).toContain("x-lambenti-agent-id");
    expect(autoRefreshSource).toContain("setInterval");
  });
});
