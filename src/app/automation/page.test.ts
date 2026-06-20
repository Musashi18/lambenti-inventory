import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Automation page refresh source contract", () => {
  it("uses client-side scan controls that refresh the page after a scan completes", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const controlsSource = readFileSync(join(__dirname, "automation-scan-controls.tsx"), "utf8");

    expect(pageSource).toContain("AutomationScanControls");
    expect(pageSource).toContain("Create Draft PR");
    expect(pageSource).toContain("Dismiss Finding");
    expect(pageSource).toContain("Open item");
    expect(controlsSource).toContain("useRouter");
    expect(controlsSource).toContain("router.refresh()");
    expect(controlsSource).toContain("animate-spin");
  });
});
