import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..");

describe("dark mode theme toggle source contract", () => {
  it("mounts a persistent dark mode toggle from the root layout without covering the desktop sidebar", () => {
    const layoutSource = readFileSync(join(projectRoot, "src", "app", "layout.tsx"), "utf8");
    const toggleSource = readFileSync(join(__dirname, "theme-toggle.tsx"), "utf8");
    const globalCss = readFileSync(join(projectRoot, "src", "app", "globals.css"), "utf8");

    expect(layoutSource).toContain("ThemeToggle");
    expect(layoutSource).toContain("@/components/theme-toggle");
    expect(layoutSource).toContain("suppressHydrationWarning");

    expect(toggleSource).toContain('"use client"');
    expect(toggleSource).toContain("localStorage");
    expect(toggleSource).toContain("lambenti-theme");
    expect(toggleSource).toContain("document.documentElement.dataset.theme");
    expect(toggleSource).toContain('aria-label="Toggle dark mode"');
    expect(toggleSource).toContain("aria-checked");
    expect(toggleSource).toContain("bottom-4");
    expect(toggleSource).toContain("left-4");
    expect(toggleSource).toContain("lg:left-auto");
    expect(toggleSource).toContain("lg:right-4");
    expect(toggleSource).toContain("relative h-5 w-9");
    expect(toggleSource).toContain("absolute left-0.5 top-0.5");
    expect(toggleSource).toContain("translate-x-4");

    expect(globalCss).toContain('[data-theme="dark"]');
    expect(globalCss).toContain("color-scheme: dark");
    expect(globalCss).toContain('[data-theme="dark"] .bg-white');
    expect(globalCss).toContain('[data-theme="dark"] .text-slate-900');
  });
});
