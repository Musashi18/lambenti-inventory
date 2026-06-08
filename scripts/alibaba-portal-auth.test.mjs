import { describe, expect, it } from "vitest";
import { detectAlibabaAuthState, looksLikeGoogleChromePath } from "./alibaba-portal-auth.mjs";

describe("Alibaba portal auth helpers", () => {
  it("detects a normal Alibaba login page separately from security challenges", () => {
    expect(detectAlibabaAuthState({
      url: "https://passport.alibaba.com/icbu_login.htm",
      text: "Sign in with your email address and password"
    })).toEqual({ loginRequired: true, securityChallengeRequired: false });
  });

  it("detects CAPTCHA/security checks as manual-intervention challenges", () => {
    expect(detectAlibabaAuthState({
      url: "https://passport.alibaba.com/security/verify",
      text: "Security verification: slide to verify you are human before continuing"
    })).toEqual({ loginRequired: false, securityChallengeRequired: true });
  });

  it("does not classify normal order text as login or security challenge", () => {
    expect(detectAlibabaAuthState({
      url: "https://www.alibaba.com/trade/order/list.htm",
      text: "Alibaba Trade Assurance Order Number 123456789 Supplier Example Total USD 100.00"
    })).toEqual({ loginRequired: false, securityChallengeRequired: false });
  });

  it("accepts Google Chrome paths and rejects Edge paths", () => {
    expect(looksLikeGoogleChromePath("C:/Program Files/Google/Chrome/Application/chrome.exe")).toBe(true);
    expect(looksLikeGoogleChromePath("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")).toBe(false);
  });
});
