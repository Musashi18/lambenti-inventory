export function normalizePortalUrl(value, fallback) {
  const normalizedFallback = String(fallback ?? "").trim();
  const trimmed = String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || /^about:blank$/i.test(trimmed)) return normalizedFallback;
  return trimmed;
}

export function buildManualChromeOpenArgs(profile, url) {
  const args = [];
  if (profile?.kind !== "chrome-work-profile" && profile?.userDataDir) {
    args.push(`--user-data-dir=${profile.userDataDir}`);
  }
  if (profile?.profileDirectory) {
    args.push(`--profile-directory=${profile.profileDirectory}`);
  }
  args.push(url);
  return args;
}

export function browserLaunchFailedBecauseProfileOpen(message) {
  return /already\s+open|Opening in existing browser session/i.test(String(message ?? ""));
}

export function browserLaunchFailedBecauseDefaultProfileRemoteDebugging(message) {
  return /DevTools remote debugging requires a non-default data directory/i.test(String(message ?? ""));
}
