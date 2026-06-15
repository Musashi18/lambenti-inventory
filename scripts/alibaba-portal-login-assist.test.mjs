import { describe, expect, it } from "vitest";
import {
  buildAlibabaAccountConfirmRegexSource,
  buildSavedGoogleContinueRegexSource,
  buildWindowsUiClickAlibabaAccountConfirmScript,
  buildWindowsUiClickButtonScript,
  matchesAlibabaAccountConfirmationText,
  matchesSavedGoogleContinueButtonName,
  normalizeContinueAsNames,
  normalizeTrustedAlibabaAccountEmails
} from "./alibaba-portal-login-assist.mjs";

describe("Alibaba portal login assist helpers", () => {
  it("builds a Continue-as matcher from the configured Chrome/Gaia identity", () => {
    const names = normalizeContinueAsNames({
      profileName: "lambenti.com",
      profileEmail: "team@lambenti.com",
      profileGaiaName: "Musashi Kaneko"
    }, "");

    expect(names).toContain("Musashi Kaneko");
    expect(names).toContain("Musashi");
    expect(names).not.toContain("lambenti.com");

    const regexSource = buildSavedGoogleContinueRegexSource(names);
    expect(matchesSavedGoogleContinueButtonName("Continue as Musashi", regexSource)).toBe(true);
    expect(matchesSavedGoogleContinueButtonName("Continue as Musashi Kaneko", regexSource)).toBe(true);
    expect(matchesSavedGoogleContinueButtonName("Continue as Someone Else", regexSource)).toBe(false);
  });

  it("allows an explicit runtime Continue-as name override", () => {
    const names = normalizeContinueAsNames({ profileGaiaName: "Other Person" }, "Musashi");
    const regexSource = buildSavedGoogleContinueRegexSource(names);

    expect(names[0]).toBe("Musashi");
    expect(matchesSavedGoogleContinueButtonName("Continue as Musashi", regexSource)).toBe(true);
  });

  it("generates a Windows UIAutomation script that waits for and invokes the matching button", () => {
    const script = buildWindowsUiClickButtonScript({ regexSource: "^Continue as Musashi$", timeoutMs: 5000 });

    expect(script).toContain("UIAutomationClient");
    expect(script).toContain("InvokePattern");
    expect(script).toContain("$regex = '^Continue as Musashi$'");
    expect(script).toContain("deadline");
  });

  it("matches Alibaba account-confirmation pages only for trusted emails", () => {
    const emails = normalizeTrustedAlibabaAccountEmails({ profileEmail: "team@lambenti.com" }, "");
    const regexSource = buildAlibabaAccountConfirmRegexSource(emails);

    expect(emails).toEqual(["team@lambenti.com"]);
    expect(matchesAlibabaAccountConfirmationText("Sign in\nContinue as\nteam@lambenti.com?\nYes", regexSource)).toBe(true);
    expect(matchesAlibabaAccountConfirmationText("Sign in\nContinue as \nteam@lambenti.com\nYes", regexSource)).toBe(true);
    expect(matchesAlibabaAccountConfirmationText("Continue as attacker@example.com?\nYes", regexSource)).toBe(false);
  });

  it("generates a guarded Windows UIAutomation script for Alibaba's Yes confirmation", () => {
    const script = buildWindowsUiClickAlibabaAccountConfirmScript({
      accountRegexSource: "Continue as\\s+team@lambenti\\.com\\?",
      timeoutMs: 5000
    });

    expect(script).toContain("$accountRegex = 'Continue as\\s+team@lambenti\\.com\\?'");
    expect(script).toContain("$yesRegex = '^\\s*Yes\\s*$'");
    expect(script).toContain("InvokePattern");
  });
});
