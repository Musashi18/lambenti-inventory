import { describe, expect, it } from "vitest";
import { detectAlibabaAuthState, looksLikeGoogleChromePath, selectChromeProfileFromLocalState } from "./alibaba-portal-auth.mjs";

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

    expect(detectAlibabaAuthState({
      url: "https://passport.alibaba.com/verify",
      text: "请按住滑块，拖动到最右边完成安全验证"
    })).toEqual({ loginRequired: false, securityChallengeRequired: true });

    expect(detectAlibabaAuthState({
      url: "https://passport.alibaba.com/ac/login_verification.htm",
      text: "For account protection, enter the SMS verification code or complete multi-factor verification."
    })).toEqual({ loginRequired: false, securityChallengeRequired: true });

    expect(detectAlibabaAuthState({
      url: "https://login.alibaba.com/riskControl.htm",
      text: "访问异常，请完成智能检测或向右滑动完成验证"
    })).toEqual({ loginRequired: false, securityChallengeRequired: true });
  });

  it("does not classify normal order text as login or security challenge", () => {
    expect(detectAlibabaAuthState({
      url: "https://biz.alibaba.com/order/list.htm",
      text: "Alibaba Trade Assurance Order Number 123456789 Supplier Example Total USD 100.00"
    })).toEqual({ loginRequired: false, securityChallengeRequired: false });
  });

  it("accepts Google Chrome paths and rejects Edge paths", () => {
    expect(looksLikeGoogleChromePath("C:/Program Files/Google/Chrome/Application/chrome.exe")).toBe(true);
    expect(looksLikeGoogleChromePath("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")).toBe(false);
  });

  it("selects the signed-in Work/Lambenti Chrome profile from Chrome Local State", () => {
    const localState = {
      profile: {
        info_cache: {
          Default: {
            name: "Person 1",
            user_name: "personal@example.com",
            gaia_name: "Personal User",
            shortcut_name: "Personal",
            is_using_default_name: true
          },
          "Profile 1": {
            name: "lambenti.com",
            user_name: "team@lambenti.com",
            gaia_name: "Musashi Kaneko",
            shortcut_name: "Work",
            is_using_default_name: false
          }
        }
      }
    };

    expect(selectChromeProfileFromLocalState(localState, ["Work", "lambenti.com"])).toMatchObject({
      directory: "Profile 1",
      name: "lambenti.com",
      userName: "team@lambenti.com"
    });
  });
});
