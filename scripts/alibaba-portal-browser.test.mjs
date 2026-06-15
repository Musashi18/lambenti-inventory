import { describe, expect, it } from "vitest";
import {
  browserLaunchFailedBecauseDefaultProfileRemoteDebugging,
  browserLaunchFailedBecauseProfileOpen,
  buildManualChromeOpenArgs,
  normalizePortalUrl
} from "./alibaba-portal-browser.mjs";

describe("Alibaba portal browser launch helpers", () => {
  it("falls back to the default Alibaba orders URL for blank/about:blank env values", () => {
    const fallback = "https://biz.alibaba.com/order/list.htm";

    expect(normalizePortalUrl(undefined, fallback)).toBe(fallback);
    expect(normalizePortalUrl("", fallback)).toBe(fallback);
    expect(normalizePortalUrl("   ", fallback)).toBe(fallback);
    expect(normalizePortalUrl("about:blank", fallback)).toBe(fallback);
    expect(normalizePortalUrl(" https://message.alibaba.com/ ", fallback)).toBe("https://message.alibaba.com/");
  });

  it("opens an already-running Work Chrome profile with profile-directory and target URL", () => {
    expect(buildManualChromeOpenArgs({
      kind: "chrome-work-profile",
      userDataDir: "C:/Users/musas/AppData/Local/Google/Chrome/User Data",
      profileDirectory: "Profile 1"
    }, "https://biz.alibaba.com/order/list.htm")).toEqual([
      "--profile-directory=Profile 1",
      "https://biz.alibaba.com/order/list.htm"
    ]);
  });

  it("opens a dedicated automation profile with its user-data-dir", () => {
    expect(buildManualChromeOpenArgs({
      kind: "dedicated-automation-profile",
      userDataDir: "C:/repo/var/alibaba-chrome-profile"
    }, "https://biz.alibaba.com/order/list.htm")).toEqual([
      "--user-data-dir=C:/repo/var/alibaba-chrome-profile",
      "https://biz.alibaba.com/order/list.htm"
    ]);
  });

  it("detects Chrome already-open profile launch failures", () => {
    expect(browserLaunchFailedBecauseProfileOpen("Chrome reported that this profile is already open in an existing browser session.")).toBe(true);
    expect(browserLaunchFailedBecauseProfileOpen("Opening in existing browser session.")).toBe(true);
    expect(browserLaunchFailedBecauseProfileOpen("executable not found")).toBe(false);
  });

  it("detects Chrome default-profile remote-debugging launch failures", () => {
    expect(browserLaunchFailedBecauseDefaultProfileRemoteDebugging("DevTools remote debugging requires a non-default data directory. Specify this using --user-data-dir.")).toBe(true);
    expect(browserLaunchFailedBecauseDefaultProfileRemoteDebugging("Opening in existing browser session.")).toBe(false);
  });
});
