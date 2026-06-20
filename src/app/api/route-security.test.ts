import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = join(process.cwd(), "src", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return routeFiles(fullPath);
    return entry === "route.ts" ? [fullPath] : [];
  });
}

describe("API route security source contract", () => {
  it("keeps every API route behind an explicit auth guard", () => {
    const unguarded = routeFiles(apiRoot).filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return !/requirePermission\(|authorizeAgentRequest\(|authFailureJson\(|authorize\(request\)/.test(source);
    }).map((filePath) => relative(process.cwd(), filePath));

    expect(unguarded).toEqual([]);
  });

  it("does not accept query-string secrets on API routes", () => {
    const offenders = routeFiles(apiRoot).filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /searchParams\.(?:get|has)\(["'](?:secret|token|apiKey|api_key)["']\)/i.test(source);
    }).map((filePath) => relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});
