export function detectAlibabaAuthState({ url = "", text = "" } = {}) {
  const limitedText = text.slice(0, 30_000);
  const securityChallengeRequired = /captcha|security verification|human verification|verify you are human|verification code|two[- ]?step|2fa|slide to verify|drag.*slider|robot|unusual traffic|risk control/i.test(limitedText)
    || /captcha|security|verify|risk/i.test(url);
  const loginRequired = !securityChallengeRequired && (
    /login|sign[- ]?in|passport|account\.alibaba/i.test(url)
    || /sign in|log in|password|email address|account name/i.test(limitedText)
  );
  return { loginRequired, securityChallengeRequired };
}

export function looksLikeGoogleChromePath(browserPath) {
  const normalized = String(browserPath ?? "").replace(/\\/g, "/").toLowerCase();
  return normalized.includes("google/chrome")
    || normalized.endsWith("/google chrome")
    || normalized.endsWith("/chrome.exe")
    || normalized.endsWith("/google-chrome")
    || normalized.endsWith("/google-chrome-stable");
}
