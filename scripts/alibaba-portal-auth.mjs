export function detectAlibabaAuthState({ url = "", text = "" } = {}) {
  const limitedText = text.slice(0, 30_000);
  const securityChallengeRequired = /captcha|security verification|security check|human verification|verify you are human|verification code|login verification|sms verification|email verification|sms code|security code|multi[- ]?factor|two[- ]?factor|two[- ]?step|2fa|mfa|slide to verify|drag.*slider|slide.*verification|verification required|account protection|robot|unusual traffic|risk control|access abnormal|访问异常|智能检测|请.*滑块|拖动滑块|向右滑动|安全验证|验证中心|验证码|二次验证|手机验证|邮箱验证|人机验证/i.test(limitedText)
    || /captcha|security|verify|verification|risk|riskcontrol/i.test(url);
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

export function selectChromeProfileFromLocalState(localStateInput, preferredProfiles = []) {
  const localState = typeof localStateInput === "string" ? JSON.parse(localStateInput) : localStateInput;
  const infoCache = localState?.profile?.info_cache ?? {};
  const profiles = Object.entries(infoCache).map(([directory, rawInfo]) => {
    const info = rawInfo ?? {};
    return {
      directory,
      name: String(info.name ?? ""),
      userName: String(info.user_name ?? ""),
      gaiaName: String(info.gaia_name ?? ""),
      shortcutName: String(info.shortcut_name ?? ""),
      isUsingDefaultName: Boolean(info.is_using_default_name)
    };
  });
  if (profiles.length === 0) return null;

  const preferences = normalizeChromeProfilePreferences(preferredProfiles);
  for (const preference of preferences) {
    const exact = profiles.find((profile) => profileMatchesPreference(profile, preference, true));
    if (exact) return exact;
  }
  for (const preference of preferences) {
    const partial = profiles.find((profile) => profileMatchesPreference(profile, preference, false));
    if (partial) return partial;
  }

  const workLike = profiles.find((profile) => {
    const haystack = profileSearchText(profile);
    return /\bwork\b|lambenti|team@|@lambenti\.com|workspace|business/i.test(haystack);
  });
  if (workLike) return workLike;

  return profiles.find((profile) => profile.directory !== "Default" && !profile.isUsingDefaultName) ?? profiles.find((profile) => profile.directory !== "Default") ?? profiles[0];
}

function normalizeChromeProfilePreferences(preferredProfiles) {
  const raw = Array.isArray(preferredProfiles) ? preferredProfiles : [preferredProfiles];
  return raw
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function profileMatchesPreference(profile, preference, exact) {
  const normalizedPreference = normalizeProfileText(preference);
  if (!normalizedPreference) return false;
  const fields = [profile.directory, profile.name, profile.userName, profile.gaiaName, profile.shortcutName].map(normalizeProfileText);
  return exact
    ? fields.some((field) => field === normalizedPreference)
    : fields.some((field) => field.includes(normalizedPreference));
}

function profileSearchText(profile) {
  return [profile.directory, profile.name, profile.userName, profile.gaiaName, profile.shortcutName].filter(Boolean).join(" ");
}

function normalizeProfileText(value) {
  return String(value ?? "").replace(/\\/g, "/").trim().toLowerCase();
}
