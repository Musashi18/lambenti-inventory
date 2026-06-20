#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const topLimit = Number(args.top ?? 8);
const statusLimit = Number(args.statusLimit ?? 12);
const paths = readListArg(args.paths);
const checkpointFiles = ["AGENTS.md", "HERMES_STATE.md", "TASK_QUEUE.md", "DECISIONS.md", "ISSUES.md"];

function main() {
  const status = git(["status", "--short", ...pathspec(paths)]);
  const diffNames = git(["diff", "--name-only", ...pathspec(paths)]);
  const diffNumstat = git(["diff", "--numstat", ...pathspec(paths)]);
  const runtime = readRuntimeMetadata();

  const statusLines = nonEmptyLines(status.stdout);
  const statusCategories = categorizeStatus(statusLines);
  const diffFiles = nonEmptyLines(diffNames.stdout);
  const numstatRows = parseNumstat(diffNumstat.stdout);
  const warningSummary = summarizeWarnings([status.stderr, diffNames.stderr, diffNumstat.stderr].join("\n"));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    scope: paths.length > 0 ? paths : ["<whole-repo>"],
    git: {
      statusEntries: statusLines.length,
      statusCategories,
      trackedDiffFiles: diffFiles.length,
      insertions: numstatRows.reduce((sum, row) => sum + row.insertions, 0),
      deletions: numstatRows.reduce((sum, row) => sum + row.deletions, 0),
      topChangedFiles: numstatRows
        .sort((a, b) => b.changedLines - a.changedLines)
        .slice(0, topLimit),
      statusPreview: statusLines.slice(0, statusLimit),
      statusPreviewTruncated: statusLines.length > statusLimit,
      suppressedGitWarnings: warningSummary
    },
    checkpoints: checkpointFiles.map((file) => ({ file, lines: lineCount(file) })).filter((entry) => entry.lines !== null),
    runtime,
    tokenEfficiency: {
      nextInspectionRule: paths.length > 0
        ? "Continue with path-filtered reads/diffs only for the scoped files."
        : "If statusEntries is large, rerun with --paths=<relevant files-or-dirs> before reading diffs.",
      avoid: ["unfiltered git diff --stat on dirty trees", "full checkpoint reads unless task is broad", "reprinting long test/build logs after a pass"],
      prefer: ["status/counts first", "top numstat files", "read_file offsets", "targeted tests", "runtime:status/runtime:ensure"]
    }
  };

  if (args.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  printHuman(snapshot);
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, raw] = value.slice(2).split("=", 2);
    parsed[key] = raw ?? true;
  }
  return parsed;
}

function readListArg(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function pathspec(values) {
  return values.length > 0 ? ["--", ...values] : [];
}

function git(gitArgs) {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...gitArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function nonEmptyLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function parseNumstat(text) {
  return nonEmptyLines(text).flatMap((line) => {
    const [insertionsRaw, deletionsRaw, file] = line.split("\t");
    if (!file) return [];
    const insertions = insertionsRaw === "-" ? 0 : Number(insertionsRaw);
    const deletions = deletionsRaw === "-" ? 0 : Number(deletionsRaw);
    return [{ file, insertions, deletions, changedLines: insertions + deletions }];
  });
}

function categorizeStatus(lines) {
  const categories = { trackedChanged: 0, untracked: 0, deleted: 0, renamed: 0, other: 0 };
  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code === "??") categories.untracked += 1;
    else if (code.includes("D")) categories.deleted += 1;
    else if (code.includes("R")) categories.renamed += 1;
    else if (/[MADU]/.test(code)) categories.trackedChanged += 1;
    else categories.other += 1;
  }
  return categories;
}

function summarizeWarnings(stderr) {
  const lines = nonEmptyLines(stderr);
  const crlfWarnings = lines.filter((line) => /CRLF will be replaced by LF|LF will be replaced by CRLF/.test(line));
  const otherWarnings = lines.filter((line) => !crlfWarnings.includes(line));
  return {
    crlfLineEndingWarnings: crlfWarnings.length,
    otherWarningLines: otherWarnings.length,
    suppressedBytes: Buffer.byteLength(stderr, "utf8")
  };
}

function lineCount(file) {
  const path = join(repoRoot, file);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split(/\r?\n/).length;
}

function readRuntimeMetadata() {
  const path = join(repoRoot, ".hermes", "runtime", "lambenti-local-server.json");
  if (!existsSync(path)) return { available: false };
  try {
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    return {
      available: true,
      baseUrl: metadata.baseUrl,
      pid: metadata.pid,
      buildId: metadata.buildId,
      sourceFingerprint: metadata.sourceFingerprint,
      checkedAt: metadata.checkedAt
    };
  } catch (error) {
    return { available: false, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function printHuman(snapshot) {
  console.log("TOKEN-EFFICIENT CONTEXT SNAPSHOT");
  console.log(`scope: ${snapshot.scope.join(", ")}`);
  console.log(`git: ${snapshot.git.statusEntries} status entries (${snapshot.git.statusCategories.trackedChanged} tracked changed, ${snapshot.git.statusCategories.untracked} untracked), ${snapshot.git.trackedDiffFiles} tracked diff files, +${snapshot.git.insertions}/-${snapshot.git.deletions}`);
  const warning = snapshot.git.suppressedGitWarnings;
  if (warning.suppressedBytes > 0) {
    console.log(`suppressed git stderr: ${warning.suppressedBytes} bytes (${warning.crlfLineEndingWarnings} CRLF/LF warning lines, ${warning.otherWarningLines} other lines)`);
  }
  if (snapshot.git.topChangedFiles.length > 0) {
    console.log("top changed files:");
    for (const row of snapshot.git.topChangedFiles) {
      console.log(`  ${String(row.changedLines).padStart(5)}  +${row.insertions}/-${row.deletions}  ${row.file}`);
    }
  }
  if (snapshot.git.statusPreview.length > 0) {
    console.log("status preview:");
    for (const line of snapshot.git.statusPreview) console.log(`  ${line}`);
    if (snapshot.git.statusPreviewTruncated) console.log("  ... truncated; rerun with --paths=<relevant paths>");
  }
  console.log("checkpoints:");
  for (const checkpoint of snapshot.checkpoints) console.log(`  ${checkpoint.file}: ${checkpoint.lines} lines`);
  if (snapshot.runtime.available) {
    console.log(`runtime: ${snapshot.runtime.baseUrl} pid=${snapshot.runtime.pid ?? "n/a"} build=${snapshot.runtime.buildId ?? "n/a"}`);
  } else {
    console.log("runtime: metadata unavailable");
  }
  console.log(`next: ${snapshot.tokenEfficiency.nextInspectionRule}`);
}

main();
