import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("DashboardPage source contract", () => {
  it("renders ledger-derived in-stock quantities on the main dashboard", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("In-Stock Quantities");
    expect(source).toContain("summary.stockItems");
    expect(source).toContain("Components on hand");
    expect(source).toContain("Build capacity");
    expect(source).toContain("bottleneck");
    expect(source).not.toContain("total BOM quantity per assembled package");
    expect(source).not.toContain("componentsRequiredPerBuild");
    expect(source).toContain("Assembled packages");
    expect(source).toContain("USD $");
    expect(source).not.toContain("Total available");
    expect(source).toContain("Reserved");
    expect(source).toContain("Available");
    expect(source).toContain("Phase I Launch Readiness");
    expect(source).toContain("25-unit Phase I target");
    expect(source).not.toContain("Phase I launch readiness");
    expect(source).not.toContain("50-package Phase I target");
    expect(source).toContain("Ready now");
    expect(source).not.toContain("A simple read-only check against");
    expect(source).not.toContain("No stock, purchasing, or accounting mutation is performed here");
    expect(source).toContain("Signals");
    expect(source).toContain("Launch Target Meter");
    expect(source).toContain("25-unit target + value mix");
    expect(source).toContain("Package Bottlenecks");
    expect(source).toContain("Stock Pressure");
    expect(source).toContain("Operations Flow");
    expect(source).toContain("Value mix");
    expect(source).toContain("summary.dashboardGraphs");
    expect(source).not.toContain("Open Next Actions");
    expect(source).not.toContain("summary.launchReadiness.nextActions.map");
    expect(source).toContain("LaunchTargetAndValueMixGraph");
    expect(source).toContain("LaunchCoverageBar");
    expect(source).toContain("Phase I coverage bridge");
    expect(source).toContain("graphs.launchCoverageSegments");
    expect(source).toContain("Ready and remaining launch coverage");
    expect(source).toContain("CompactValuationMixGraph");
    expect(source).toContain("flex h-full min-w-0 flex-col gap-4");
    expect(source).not.toContain("lg:grid-cols-[minmax(0,1fr)_minmax(11rem,0.72fr)]");
    expect(source.indexOf("<LaunchTargetGraph readiness={readiness} graphs={graphs} />")).toBeLessThan(
      source.indexOf("<CompactValuationMixGraph graphs={graphs} />")
    );
    expect(source).toContain("auto-rows-fr");
    expect(source).not.toContain("<GraphPanel title=\"Value mix\"");
    expect(source).not.toContain("Useful Visual Signals");
    expect(source).not.toContain("Graphs are intentionally limited");
    expect(source.indexOf("Signals")).toBeLessThan(source.indexOf("Low stock items"));
    expect(source).not.toContain("Launch Next Action");
    expect(source).not.toContain("Buildable Now");
    expect(source).not.toContain("Buildable now");
    expect(source).not.toContain("Unblock package build capacity");
    expect(source).toContain("formatItemType(item)");
  });
});
