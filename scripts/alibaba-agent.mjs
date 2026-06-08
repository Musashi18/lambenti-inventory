#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const emailOnlyArgs = args.filter((arg) => !["--setup-login", "--login", "--headless", "--dry-run", "--deep"].includes(arg));

const portal = runScript("alibaba-portal-agent.mjs", args);
const email = runScript("alibaba-order-agent.mjs", emailOnlyArgs);

const output = [portal.stdout, email.stdout].filter((value) => value.trim().length > 0).join("\n\n");
const errors = [portal.stderr, email.stderr].filter((value) => value.trim().length > 0).join("\n\n");

if (output.trim().length > 0) console.log(output.trim());
if (errors.trim().length > 0) console.error(errors.trim());

process.exit(portal.status !== 0 ? portal.status : email.status !== 0 ? email.status : 0);

function runScript(scriptName, scriptArgs) {
  return spawnSync(process.execPath, [path.join(projectRoot, "scripts", scriptName), ...scriptArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });
}
