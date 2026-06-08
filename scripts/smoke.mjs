import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const host = "127.0.0.1";
const port = 5173;
const baseUrl = `http://${host}:${port}`;

const pageRoutes = [
  ["/", "Operations dashboard"],
  ["/inventory/items", "Inventory items"],
  ["/inventory/movements", "Stock movement history"],
  ["/inventory/valuation", "Inventory valuation"],
  ["/suppliers", "Suppliers"],
  ["/purchasing/recommendations", "Purchase recommendations"],
  ["/purchasing/requests", "Purchase request approvals"],
  ["/boms", "BOM builder"],
  ["/incoming", "Incoming inventory tracker"],
  ["/integrations/email-import", "Order Email Agent"],
  ["/integrations/alibaba-email", "Order Email Agent"],
  ["/accounting/invoices", "Accounting invoices"]
];

const apiRoutes = [
  "/api/agent/stock",
  "/api/agent/boms",
  "/api/agent/shortages",
  "/api/agent/supplier-offers"
];

const uiContracts = [
  {
    route: "/inventory/items",
    expected: ["Active item catalog", "CSV import / export", "Collapsed by default"],
    rejected: ["has received your initial payment", "has drafted a Trade Assurance contract"],
    ordered: ["Active item catalog", "CSV import / export"]
  },
  {
    route: "/suppliers",
    expected: ["Saved supplier contact information", "Edit company", "Edit email", "Edit dropdown confirmation", "Item sourcing rows"]
  },
  {
    route: "/automation",
    expected: ["Manual safe automation", "Run reorder scan", "Run anomaly scan", "Recent automation runs"]
  },
  {
    route: "/boms",
    expected: ["Create another finished unit section", "Add component line", "Remove row"],
    rejected: ["Active items imported from item master"]
  },
  {
    route: "/integrations/email-import",
    expected: ["Sync mailbox now", "Sync &amp; reassess recent imports", "Import a supplier order email manually", "Collapsed by default"]
  }
];

async function main() {
  await run("npm", ["run", "build"]);
  await stopPortOwner(port);

  const server = startServer();
  try {
    await waitForReady();
    for (const [route, expectedText] of pageRoutes) {
      await assertPage(route, expectedText);
    }
    for (const contract of uiContracts) {
      await assertUiContract(contract);
    }
    for (const route of apiRoutes) {
      await assertJsonApi(route);
    }
    console.log(`Smoke passed: ${pageRoutes.length} pages, ${uiContracts.length} UI contracts, and ${apiRoutes.length} APIs at ${baseUrl}`);
  } finally {
    await stopServer(server);
  }
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const invocation = commandInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args]
  };
}

function startServer() {
  const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-H", host, "-p", String(port)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LAMBENTI_ALLOW_LOCAL_PROD_AUTH: "true"
    }
  });
}

async function waitForReady(timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Server did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function assertPage(route, expectedText) {
  const response = await fetch(`${baseUrl}${route}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes(expectedText)) {
    throw new Error(`${route} did not contain expected text: ${expectedText}`);
  }
  console.log(`PAGE ${route} OK`);
}

async function assertUiContract({ route, expected = [], rejected = [], ordered = [] }) {
  const response = await fetch(`${baseUrl}${route}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  const html = await response.text();

  for (const text of expected) {
    if (!html.includes(text)) throw new Error(`${route} UI contract missing expected text: ${text}`);
  }
  for (const text of rejected) {
    if (html.includes(text)) throw new Error(`${route} UI contract contained rejected text: ${text}`);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const previousIndex = html.indexOf(previous);
    const currentIndex = html.indexOf(current);
    if (previousIndex === -1 || currentIndex === -1 || previousIndex >= currentIndex) {
      throw new Error(`${route} UI contract order failed: ${previous} should appear before ${current}`);
    }
  }

  console.log(`UI   ${route} OK`);
}

async function assertJsonApi(route) {
  const response = await fetch(`${baseUrl}${route}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${route} returned non-JSON content type: ${contentType}`);
  }
  const json = await response.json();
  if (json === null || typeof json !== "object") {
    throw new Error(`${route} returned an invalid JSON payload`);
  }
  console.log(`API  ${route} OK`);
}

async function stopPortOwner(portToStop) {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("netstat", ["-ano"]);
      const pids = new Set(
        stdout
          .split(/\r?\n/)
          .filter((line) => line.includes(`${host}:${portToStop}`) && /LISTENING/i.test(line))
          .map((line) => line.trim().split(/\s+/).at(-1))
          .filter(Boolean)
      );
      for (const pid of pids) {
        await execFileAsync("taskkill", ["/F", "/PID", pid]);
        console.log(`Stopped stale server on ${host}:${portToStop} (PID ${pid})`);
      }
    } catch {
      // Best-effort cleanup only; next start will fail clearly if the port is still occupied.
    }
    return;
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${portToStop}`]);
    const pids = stdout.split(/\s+/).filter(Boolean);
    for (const pid of pids) {
      process.kill(Number(pid), "SIGTERM");
      console.log(`Stopped stale server on ${host}:${portToStop} (PID ${pid})`);
    }
  } catch {
    // lsof may be absent; best effort only.
  }
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    })
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
