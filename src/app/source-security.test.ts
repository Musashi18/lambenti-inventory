import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignoredSegments = new Set(["node_modules", ".next", "var"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (ignoredSegments.has(entry)) return [];
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    if (!sourceExtensions.has(extname(entry))) return [];
    if (/\.test\.[tj]sx?$/.test(entry)) return [];
    return [fullPath];
  });
}

describe("application source security contract", () => {
  it("does not use high-risk dynamic script/rendering escape hatches", () => {
    const forbidden = [
      { label: "dangerouslySetInnerHTML", pattern: /dangerouslySetInnerHTML/ },
      { label: "eval", pattern: /\beval\s*\(/ },
      { label: "new Function", pattern: /new\s+Function\s*\(/ }
    ];

    const offenders = sourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return forbidden
        .filter(({ pattern }) => pattern.test(source))
        .map(({ label }) => `${relative(process.cwd(), filePath)}: ${label}`);
    });

    expect(offenders).toEqual([]);
  });
});
