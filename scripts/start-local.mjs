import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(projectRoot, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", "5173"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    // `next start` always runs with NODE_ENV=production. This flag keeps the
    // local, loopback-only operator app usable without configuring deployment
    // auth secrets, while production/non-loopback requests still fail closed.
    LAMBENTI_ALLOW_LOCAL_PROD_AUTH: "true"
  },
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
