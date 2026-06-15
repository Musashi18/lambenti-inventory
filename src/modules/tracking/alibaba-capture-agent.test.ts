import { describe, expect, it } from "vitest";
import {
  alibabaPortalTrackingActionSucceeded,
  buildAlibabaPortalTrackingCaptureCommand,
  buildAlibabaPortalTrackingCaptureEnv,
  parseAlibabaPortalAgentJson,
  summarizeAlibabaPortalTrackingCapture
} from "./alibaba-capture-agent";

describe("Alibaba portal tracking capture agent wrapper", () => {
  it("builds a tracking-only portal-agent command so the /tracking button does not create invoices or receive stock", () => {
    const command = buildAlibabaPortalTrackingCaptureCommand({ projectRoot: "C:/repo/lambenti-inventory" });

    expect(command.args.map((arg) => arg.replace(/\\/g, "/"))).toEqual([
      "C:/repo/lambenti-inventory/scripts/alibaba-portal-agent.mjs",
      "--json",
      "--tracking-only",
      "--deep",
      "--recent-months=3"
    ]);
    expect(command.cwd).toBe("C:/repo/lambenti-inventory");
    expect(command.env.LAMBENTI_ALIBABA_USE_WORK_CHROME_PROFILE).toBe("false");
    expect(command.env.LAMBENTI_ALIBABA_BROWSER_USER_DATA_DIR).toBe("");
    expect(command.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIRECTORY).toBe("");
    expect(command.env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR?.replace(/\\/g, "/")).toBe("C:/repo/lambenti-inventory/var/alibaba-chrome-profile");
  });

  it("keeps an explicit opt-in escape hatch for using the normal Work Chrome profile", () => {
    const env = buildAlibabaPortalTrackingCaptureEnv("C:/repo/lambenti-inventory", {
      LAMBENTI_ALIBABA_TRACKING_CAPTURE_USE_WORK_PROFILE: "true",
      LAMBENTI_ALIBABA_BROWSER_USER_DATA_DIR: "C:/Users/musas/AppData/Local/Google/Chrome/User Data",
      LAMBENTI_ALIBABA_BROWSER_PROFILE_DIRECTORY: "Profile 1"
    });

    expect(env.LAMBENTI_ALIBABA_BROWSER_USER_DATA_DIR).toBe("C:/Users/musas/AppData/Local/Google/Chrome/User Data");
    expect(env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIRECTORY).toBe("Profile 1");
  });

  it("carries the Lambenti email as the trusted Alibaba account confirmation fallback for the dedicated profile", () => {
    const env = buildAlibabaPortalTrackingCaptureEnv("C:/repo/lambenti-inventory", {
      LAMBENTI_EMAIL_IMAP_USER: "team@lambenti.com"
    });

    expect(env.LAMBENTI_ALIBABA_ACCOUNT_CONFIRM_EMAIL).toBe("team@lambenti.com");
  });

  it("gives the interactive Alibaba portal sweep enough time to read order tabs and message threads", async () => {
    const { runAlibabaPortalTrackingCapture } = await import("./alibaba-capture-agent");
    let observedTimeout = 0;
    await runAlibabaPortalTrackingCapture({
      projectRoot: "C:/repo/lambenti-inventory",
      runner: async (_command, timeoutMs) => {
        observedTimeout = timeoutMs;
        return { exitCode: 0, stdout: "{\"configured\":true,\"capturedSnapshots\":0,\"errors\":[]}", stderr: "" };
      }
    });

    expect(observedTimeout).toBeGreaterThanOrEqual(420_000);
  });

  it("does not treat existing-row backfill updates as a successful live capture when the portal was blocked", () => {
    expect(alibabaPortalTrackingActionSucceeded({
      portal: {
        configured: false,
        loginRequired: false,
        securityChallengeRequired: false,
        autoLoginAttempted: false,
        capturedSnapshots: 0,
        imported: 0,
        duplicates: 0,
        appliedOrAlreadyApplied: 0,
        invoicesCreatedOrUpdated: 0,
        needsReview: 0,
        errors: ["controlled Chrome access blocked"],
        trackingCaptureDeferred: true
      },
      backfill: { scanned: 3, saved: 0, updated: 2, skipped: 0 },
      prune: { pruned: 0 }
    })).toBe(false);
  });

  it("parses the JSON result even if the child process prints bounded diagnostic text", () => {
    expect(parseAlibabaPortalAgentJson("prelude\n{\"configured\":true,\"capturedSnapshots\":2,\"imported\":1,\"errors\":[]}\n")).toMatchObject({
      configured: true,
      capturedSnapshots: 2,
      imported: 1,
      errors: []
    });
  });

  it("summarizes portal capture and saved-evidence backfill with manual handoff details", () => {
    const message = summarizeAlibabaPortalTrackingCapture({
      portal: {
        configured: false,
        loginRequired: false,
        securityChallengeRequired: false,
        autoLoginAttempted: false,
        capturedSnapshots: 0,
        imported: 0,
        duplicates: 0,
        appliedOrAlreadyApplied: 0,
        invoicesCreatedOrUpdated: 0,
        needsReview: 0,
        errors: ["Chrome Work profile is already open; close it and retry controlled capture."],
        manualBrowserOpened: true,
        trackingMemory: {
          ordersRemembered: 2,
          messageThreadsRemembered: 4,
          savedTrackingOrdersHydrated: 1,
          orderCandidatesSkippedKnownTracking: 1,
          orderCandidatesSkippedGenericLogistics: 1,
          orderCandidatesSkippedWaitingToShip: 1,
          orderCandidatesSkippedAlreadyChecked: 2,
          messageThreadsSkippedStale: 3
        }
      },
      backfill: { scanned: 3, saved: 1, updated: 2, skipped: 0 }
    });

    expect(message).toContain("Alibaba portal tracking capture could not complete automatically");
    expect(message).toContain("manual Chrome/login handoff was opened");
    expect(message).toContain("dedicated Alibaba automation profile");
    expect(message).toContain("Backfill scanned 3 saved Alibaba/email import(s); saved 1, updated 2");
    expect(message).toContain("Completed & In Review orders");
    expect(message).toContain("Waiting for supplier to ship");
    expect(message).toContain("Stale-scan memory kept future runs faster");
    expect(message).toContain("1 saved-tracking order(s) recognized before clicking");
    expect(message).toContain("1 generic logistics-service candidate(s) skipped");
    expect(message).toContain("2 already-checked unchanged order candidate(s) skipped");
    expect(message).toContain("3 unchanged message thread(s) skipped");
    expect(message).toContain("tracking-only mode");
    expect(message).toContain("dedicated Alibaba automation Chrome profile");
    expect(message).toContain("does not receive stock");
  });
});
