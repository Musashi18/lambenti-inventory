import { spawn } from "node:child_process";
import { join } from "node:path";

export type AlibabaPortalAgentResult = {
  configured: boolean;
  loginRequired: boolean;
  securityChallengeRequired: boolean;
  autoLoginAttempted: boolean;
  capturedSnapshots: number;
  imported: number;
  duplicates: number;
  appliedOrAlreadyApplied: number;
  invoicesCreatedOrUpdated: number;
  needsReview: number;
  errors: string[];
  manualBrowserOpened?: boolean;
  savedGoogleContinueClicked?: boolean;
  alibabaAccountConfirmClicked?: boolean;
  trackingCaptureDeferred?: boolean;
  trackingMemory?: {
    path?: string;
    ordersRemembered?: number;
    messageThreadsRemembered?: number;
    savedTrackingRowsHydrated?: number;
    savedTrackingOrdersHydrated?: number;
    orderCandidatesSkippedKnownTracking?: number;
    orderCandidatesSkippedGenericLogistics?: number;
    orderCandidatesSkippedWaitingToShip?: number;
    orderCandidatesSkippedAlreadyChecked?: number;
    orderCandidatesRead?: number;
    messageThreadsSkippedStale?: number;
    messageThreadsRead?: number;
  };
  message?: string;
};

export type AlibabaTrackingBackfillResult = {
  scanned: number;
  saved: number;
  updated: number;
  skipped: number;
};

export type AlibabaPortalTrackingCommand = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

type ProcessRunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

type ProcessRunner = (command: AlibabaPortalTrackingCommand, timeoutMs: number) => Promise<ProcessRunResult>;

const DEFAULT_CAPTURE_TIMEOUT_MS = 420_000;
const MAX_CHILD_OUTPUT_CHARS = 120_000;

export function buildAlibabaPortalTrackingCaptureCommand(input: { projectRoot?: string; env?: Partial<NodeJS.ProcessEnv>; targetUrls?: string[] } = {}): AlibabaPortalTrackingCommand {
  const projectRoot = input.projectRoot ?? process.cwd();
  const env = buildAlibabaPortalTrackingCaptureEnv(projectRoot, input.env);
  const targetArgs = uniqueTargetUrls(input.targetUrls ?? [])
    .map((url) => `--tracking-target-url=${url}`);
  return {
    command: process.execPath,
    args: [
      join(projectRoot, "scripts", "alibaba-portal-agent.mjs"),
      "--json",
      "--tracking-only",
      "--deep",
      "--recent-months=3",
      ...targetArgs
    ],
    cwd: projectRoot,
    env
  };
}

export function buildAlibabaPortalTrackingCaptureEnv(projectRoot: string, inputEnv: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...inputEnv };
  if (!env.LAMBENTI_ALIBABA_ACCOUNT_CONFIRM_EMAIL && env.LAMBENTI_EMAIL_IMAP_USER) {
    env.LAMBENTI_ALIBABA_ACCOUNT_CONFIRM_EMAIL = env.LAMBENTI_EMAIL_IMAP_USER;
  }
  if (!/^true$/i.test(env.LAMBENTI_ALIBABA_TRACKING_CAPTURE_USE_WORK_PROFILE ?? "")) {
    env.LAMBENTI_ALIBABA_USE_WORK_CHROME_PROFILE = "false";
    env.LAMBENTI_ALIBABA_BROWSER_USER_DATA_DIR = "";
    env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIRECTORY = "";
    env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR = env.LAMBENTI_ALIBABA_TRACKING_BROWSER_PROFILE_DIR
      ?? env.LAMBENTI_ALIBABA_BROWSER_PROFILE_DIR
      ?? join(projectRoot, "var", "alibaba-chrome-profile");
  }
  return env;
}

export async function runAlibabaPortalTrackingCapture(input: {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  runner?: ProcessRunner;
  targetUrls?: string[];
} = {}): Promise<AlibabaPortalAgentResult> {
  const command = buildAlibabaPortalTrackingCaptureCommand({ projectRoot: input.projectRoot, env: input.env, targetUrls: input.targetUrls });
  const timeoutMs = positiveInt(input.timeoutMs ?? command.env.LAMBENTI_ALIBABA_CAPTURE_TIMEOUT_MS, DEFAULT_CAPTURE_TIMEOUT_MS);
  const runner = input.runner ?? spawnPortalAgent;
  const result = await runner(command, timeoutMs);

  try {
    return coerceAlibabaPortalAgentResult(parseAlibabaPortalAgentJson(result.stdout));
  } catch (error) {
    const detail = [
      result.timedOut ? `Alibaba portal tracking capture timed out after ${timeoutMs} ms.` : null,
      result.exitCode && result.exitCode !== 0 ? `Alibaba portal tracking capture exited with code ${result.exitCode}.` : null,
      result.stderr.trim() ? `stderr: ${truncate(result.stderr.trim(), 2000)}` : null,
      result.stdout.trim() ? `stdout: ${truncate(result.stdout.trim(), 2000)}` : null,
      `Could not parse Alibaba portal agent JSON: ${error instanceof Error ? error.message : String(error)}`
    ].filter(Boolean).join(" ");

    return coerceAlibabaPortalAgentResult({
      configured: false,
      errors: [detail]
    });
  }
}

export function parseAlibabaPortalAgentJson(stdout: string): AlibabaPortalAgentResult {
  const text = String(stdout ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in portal-agent stdout.");
  return JSON.parse(text.slice(start, end + 1));
}

export function alibabaPortalTrackingCaptureSucceeded(result: AlibabaPortalAgentResult) {
  return result.configured !== false
    && !result.loginRequired
    && !result.securityChallengeRequired
    && result.errors.length === 0
    && !result.trackingCaptureDeferred;
}

export function alibabaPortalTrackingActionSucceeded(input: {
  portal: AlibabaPortalAgentResult;
  backfill: AlibabaTrackingBackfillResult;
  prune?: { pruned: number };
}) {
  const foundNewTrackingEvidence = input.portal.imported > 0 || input.backfill.saved > 0 || (input.prune?.pruned ?? 0) > 0;
  if (foundNewTrackingEvidence) return true;
  return alibabaPortalTrackingCaptureSucceeded(input.portal);
}

export function summarizeAlibabaPortalTrackingCapture(input: {
  portal: AlibabaPortalAgentResult;
  backfill: AlibabaTrackingBackfillResult;
}) {
  const { portal, backfill } = input;
  const lines: string[] = [];
  const succeeded = alibabaPortalTrackingCaptureSucceeded(portal);

  if (succeeded) {
    lines.push("Alibaba portal tracking capture completed automatically in tracking-only mode.");
  } else {
    lines.push("Alibaba portal tracking capture could not complete automatically in tracking-only mode.");
  }

  if (portal.autoLoginAttempted) lines.push("Chrome saved-login / saved-Google assist was attempted before capture.");
  if (portal.savedGoogleContinueClicked) lines.push("Clicked the saved Google sign-in button matching the configured account.");
  if (portal.alibabaAccountConfirmClicked) lines.push("Clicked Alibaba's trusted-account confirmation.");
  if (portal.manualBrowserOpened) lines.push("A manual Chrome/login handoff was opened for the dedicated Alibaba automation profile.");

  lines.push(
    `Portal snapshots ${portal.capturedSnapshots}; imported ${portal.imported}, duplicates ${portal.duplicates}, `
    + `applied/already applied ${portal.appliedOrAlreadyApplied}, invoices created/updated ${portal.invoicesCreatedOrUpdated}, needs review ${portal.needsReview}.`
  );
  if (portal.trackingMemory) {
    lines.push(
      `Stale-scan memory kept future runs faster: ${portal.trackingMemory.ordersRemembered ?? 0} order candidate(s), `
      + `${portal.trackingMemory.messageThreadsRemembered ?? 0} message thread(s), `
      + `${portal.trackingMemory.savedTrackingOrdersHydrated ?? 0} saved-tracking order(s) recognized before clicking, `
      + `${portal.trackingMemory.orderCandidatesSkippedKnownTracking ?? 0} already-tracked order candidate(s) skipped, `
      + `${portal.trackingMemory.orderCandidatesSkippedGenericLogistics ?? 0} generic logistics-service candidate(s) skipped, `
      + `${portal.trackingMemory.orderCandidatesSkippedWaitingToShip ?? 0} waiting-to-ship candidate(s) skipped, `
      + `${portal.trackingMemory.orderCandidatesSkippedAlreadyChecked ?? 0} already-checked unchanged order candidate(s) skipped, `
      + `${portal.trackingMemory.messageThreadsSkippedStale ?? 0} unchanged message thread(s) skipped.`
    );
  }
  lines.push(`Backfill scanned ${backfill.scanned} saved Alibaba/email import(s); saved ${backfill.saved}, updated ${backfill.updated}, skipped ${backfill.skipped}.`);

  if (portal.errors.length > 0) lines.push(`Portal warning(s): ${portal.errors.join("; ")}`);
  if (portal.loginRequired) lines.push("Alibaba still needs manual login in the dedicated Alibaba automation Chrome profile before controlled scraping can continue.");
  if (portal.securityChallengeRequired) lines.push("Alibaba showed a CAPTCHA/2FA/security challenge; complete it manually in the dedicated Alibaba automation Chrome profile, then close that Chrome window and rerun Capture.");

  lines.push("The portal run checks Alibaba order tracking surfaces in this sequence: Delivering orders, Completed & In Review orders, then individual Message Center supplier conversations; order candidates marked `Waiting for supplier to ship` are skipped.");
  lines.push("Controlled tracking capture uses the dedicated Alibaba automation Chrome profile by default because current Chrome blocks DevTools control of the normal Work profile.");
  lines.push("The portal run uses tracking-only mode (autoApply=false, autoCreateInvoices=false); it saves/link tracking evidence only and does not receive stock, pay invoices, or confirm delivery.");
  return lines.join(" ");
}


function uniqueTargetUrls(values: string[]) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    urls.push(trimmed);
  }
  return urls;
}

function coerceAlibabaPortalAgentResult(value: Partial<AlibabaPortalAgentResult>): AlibabaPortalAgentResult {
  return {
    configured: value.configured ?? true,
    loginRequired: value.loginRequired ?? false,
    securityChallengeRequired: value.securityChallengeRequired ?? false,
    autoLoginAttempted: value.autoLoginAttempted ?? false,
    capturedSnapshots: value.capturedSnapshots ?? 0,
    imported: value.imported ?? 0,
    duplicates: value.duplicates ?? 0,
    appliedOrAlreadyApplied: value.appliedOrAlreadyApplied ?? 0,
    invoicesCreatedOrUpdated: value.invoicesCreatedOrUpdated ?? 0,
    needsReview: value.needsReview ?? 0,
    errors: Array.isArray(value.errors) ? value.errors.map(String) : [],
    manualBrowserOpened: value.manualBrowserOpened,
    savedGoogleContinueClicked: value.savedGoogleContinueClicked,
    alibabaAccountConfirmClicked: value.alibabaAccountConfirmClicked,
    trackingCaptureDeferred: value.trackingCaptureDeferred,
    trackingMemory: value.trackingMemory,
    message: value.message
  };
}

function spawnPortalAgent(command: AlibabaPortalTrackingCommand, timeoutMs: number): Promise<ProcessRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = boundedAppend(stdout, String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr = boundedAppend(stderr, String(chunk));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: boundedAppend(stderr, error.message), timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function boundedAppend(existing: string, addition: string) {
  const combined = existing + addition;
  return combined.length > MAX_CHILD_OUTPUT_CHARS ? combined.slice(-MAX_CHILD_OUTPUT_CHARS) : combined;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function truncate(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}
