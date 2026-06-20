#!/usr/bin/env node
import { spawn, execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeDir = join(repoRoot, ".hermes", "runtime");
const runtimeFile = join(runtimeDir, "lambenti-local-server.json");
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const defaultHost = "127.0.0.1";
const defaultPort = 5173;
const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "status";
const host = args.host ?? defaultHost;
const port = Number(args.port ?? defaultPort);
const baseUrl = (args["base-url"] ?? `http://${host}:${port}`).replace(/\/$/, "");
const defaultRoutes = ["/", "/inventory/movements"];

async function main() {
  if (command === "status") {
    await writeStatus({ checkedOnly: true });
    return;
  }
  if (command === "stop") {
    await stopPortOwner(port, { required: false });
    await writeStatus({ stopped: true });
    return;
  }
  if (command === "start" || command === "ensure") {
    if (args.restart) {
      await stopPortOwner(port, { required: false });
    }
    if (args.build) {
      await runBuild();
    }
    const existingOwners = await portOwners(port);
    if (existingOwners.length > 0 && !args.restart) {
      console.log(`REUSE existing server on ${baseUrl} owner(s): ${existingOwners.join(", ")}`);
    } else {
      await startDetachedServer();
    }
    const routes = readRoutes(args.routes ?? defaultRoutes.join(","));
    const probes = await waitForReadyAndProbe(routes);
    await writeStatus({ started: true, probes });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (const value of values) {
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const [key, raw] = value.slice(2).split("=", 2);
    parsed[key] = raw ?? true;
  }
  return parsed;
}

function readRoutes(value) {
  if (Array.isArray(value)) return value;
  return String(value)
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean)
    .map((route) => route.startsWith("/") ? route : `/${route}`);
}

async function runBuild() {
  console.log("BUILD npm run build (NODE_OPTIONS includes --max-old-space-size=6144)");
  await run("npm", ["run", "build"], {
    ...process.env,
    NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, "--max-old-space-size=6144")
  });
}

function mergeNodeOptions(current, addition) {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} ${addition}`;
}

async function run(commandName, commandArgs, env = process.env) {
  await new Promise((resolve, reject) => {
    const invocation = commandInvocation(commandName, commandArgs);
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandName} ${commandArgs.join(" ")} exited with ${code}`));
    });
  });
}

function commandInvocation(commandName, commandArgs) {
  if (process.platform !== "win32") return { command: commandName, args: commandArgs };
  return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", commandName, ...commandArgs] };
}

async function startDetachedServer() {
  const child = spawn(process.execPath, [nextBin, "start", "-H", host, "-p", String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      LAMBENTI_ALLOW_LOCAL_PROD_AUTH: "true"
    }
  });
  child.unref();
  console.log(`START detached next start wrapper PID ${child.pid} at ${baseUrl}`);
}

async function waitForReadyAndProbe(routes, timeoutMs = Number(args.timeout ?? 45_000)) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) break;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  if (Date.now() - startedAt >= timeoutMs) {
    throw new Error(`Server did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  const probes = [];
  for (const route of routes) {
    const url = `${baseUrl}${route}`;
    const started = Date.now();
    const response = await fetch(url, { cache: "no-store" });
    probes.push({ route, status: response.status, ok: response.ok, durationMs: Date.now() - started });
    if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  }
  return probes;
}

async function stopPortOwner(portToStop, { required }) {
  const owners = await portOwners(portToStop);
  if (owners.length === 0) {
    console.log(`PORT ${portToStop} clear`);
    if (required) throw new Error(`No server found on ${host}:${portToStop}`);
    return;
  }
  for (const pid of owners) {
    await killPid(pid);
    console.log(`STOPPED stale server on ${host}:${portToStop} (PID ${pid})`);
  }
}

async function portOwners(portToCheck) {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("netstat", ["-ano"]);
    return Array.from(new Set(stdout
      .split(/\r?\n/)
      .filter((line) => line.includes(`${host}:${portToCheck}`) && /LISTENING/i.test(line))
      .map((line) => line.trim().split(/\s+/).at(-1))
      .filter(Boolean)));
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${portToCheck}`]);
    return Array.from(new Set(stdout.split(/\s+/).filter(Boolean)));
  } catch {
    return [];
  }
}

async function killPid(pid) {
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/F", "/PID", String(pid)]);
    return;
  }
  process.kill(Number(pid), "SIGTERM");
}

async function writeStatus(extra = {}) {
  const owners = await portOwners(port);
  const status = {
    app: "lambenti-inventory",
    baseUrl,
    host,
    port,
    portOwners: owners,
    pid: owners[0] ?? null,
    buildId: readOptional(join(repoRoot, ".next", "BUILD_ID"))?.trim() ?? null,
    sourceFingerprint: sourceFingerprint(),
    checkedAt: new Date().toISOString(),
    ...extra
  };
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(runtimeFile, `${JSON.stringify(status, null, 2)}\n`);
  console.log(JSON.stringify(status, null, 2));
}

function sourceFingerprint() {
  const head = git(["rev-parse", "--short", "HEAD"]);
  const status = git(["status", "--short"]);
  return createHash("sha256").update(`${head}\n${status}`).digest("hex").slice(0, 16);
}

function git(gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
