import { describe, expect, it, vi } from "vitest";
import {
  buildTrackingRefreshRequest,
  formatTrackingRefreshNotification,
  shouldAttemptTrackingRefresh,
  shouldNotifyTrackingRefresh,
  runTrackingRefresh
} from "./tracking-refresh.mjs";

describe("tracking refresh scheduler script helpers", () => {
  it("stays silent for scheduled runs until a tracking provider is configured", () => {
    expect(shouldAttemptTrackingRefresh({ LAMBENTI_TRACKING_STATUS_URL_TEMPLATE: "" })).toBe(false);
    expect(shouldAttemptTrackingRefresh({ LAMBENTI_TRACKING_STATUS_URL_TEMPLATE: "https://provider.test/{trackingNumber}" })).toBe(true);
    expect(shouldAttemptTrackingRefresh({ LAMBENTI_TRACKING_STATUS_PROVIDER: "SHIP24", LAMBENTI_TRACKING_STATUS_AUTH_TOKEN: "ship24-key" })).toBe(true);
    expect(shouldAttemptTrackingRefresh({ LAMBENTI_TRACKING_STATUS_PROVIDER: "SHIP24", LAMBENTI_TRACKING_STATUS_AUTH_TOKEN: "" })).toBe(false);
  });

  it("reports a skipped diagnostic without calling the refresh API when no provider is configured", async () => {
    const fetcher = vi.fn();
    await expect(runTrackingRefresh({
      env: { LAMBENTI_INVENTORY_BASE_URL: "http://127.0.0.1:5173", LAMBENTI_TRACKING_STATUS_URL_TEMPLATE: "" },
      options: { verbose: true, jsonOnly: false, limit: 25, agentId: "tracking-refresh-scheduler" },
      fetcher
    })).resolves.toMatchObject({ configured: false, skipped: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("builds an authenticated refresh API request without trusting body actor identity", () => {
    const request = buildTrackingRefreshRequest({
      baseUrl: "http://127.0.0.1:5173/",
      limit: 17,
      agentId: "tracking-refresh-scheduler",
      secret: "test-secret"
    });

    expect(request.url).toBe("http://127.0.0.1:5173/api/tracking/refresh");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toMatchObject({
      "content-type": "application/json",
      "x-lambenti-agent-id": "tracking-refresh-scheduler",
      authorization: "Bearer test-secret"
    });
    expect(JSON.parse(String(request.init.body))).toEqual({ dueOnly: true, limit: 17 });
  });

  it("only notifies quiet schedules when refresh changed state or failed", () => {
    expect(shouldNotifyTrackingRefresh({ scanned: 0, refreshed: 0, failed: 0, skipped: 3 }, { verbose: false, jsonOnly: false })).toBe(false);
    expect(shouldNotifyTrackingRefresh({ scanned: 2, refreshed: 1, failed: 0, skipped: 3 }, { verbose: false, jsonOnly: false })).toBe(true);
    expect(shouldNotifyTrackingRefresh({ scanned: 1, refreshed: 0, failed: 1, skipped: 3 }, { verbose: false, jsonOnly: false })).toBe(true);
  });

  it("formats a useful operator notification with the tracking workbench URL", () => {
    expect(formatTrackingRefreshNotification({ scanned: 2, refreshed: 1, failed: 0, skipped: 3 }, "http://127.0.0.1:5173")).toContain("Tracking refresh checked 2 due number(s); refreshed 1, failed 0, skipped 3.");
    expect(formatTrackingRefreshNotification({ scanned: 2, refreshed: 1, failed: 0, skipped: 3 }, "http://127.0.0.1:5173")).toContain("http://127.0.0.1:5173/tracking");
  });
});
