import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Sidebar branding source contract", () => {
  it("uses Inventory and Sourcing as the primary sidebar title without visible Lambenti wordmark text", () => {
    const source = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");

    expect(source).toContain("Inventory and Sourcing");
    expect(source).toContain("px-3 text-xl font-semibold text-ink");
    expect(source).not.toMatch(/>Lambenti</);
  });

  it("keeps the movements navigation as a plain high-z-index anchor so wide item tables cannot trap clicks", () => {
    const source = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");

    expect(source).toContain('href: "/inventory/movements", label: "Movements"');
    expect(source).toContain("isolate relative z-50");
    expect(source).toContain("relative z-10 flex items-center");
    expect(source).toContain("<a");
    expect(source).not.toContain("next/link");
  });

  it("mounts the client logo control with one persisted current logo and the edit dropbox", () => {
    const sidebarSource = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");
    const logoSource = readFileSync(join(__dirname, "sidebar-logo-control.tsx"), "utf8");

    expect(sidebarSource).toContain("SidebarLogoControl");
    expect(logoSource).toContain('"use client"');
    expect(logoSource).toContain("Edit");
    expect(logoSource).toContain("Save Logo");
    expect(logoSource).toContain("lambenti-sidebar-logo-settings");
    expect(logoSource).toContain("RETIRED_STORAGE_KEYS");
    expect(logoSource).toContain("lambenti-sidebar-logo-layout-v2");
    expect(logoSource).toContain("window.localStorage.removeItem(retiredKey)");
    expect(logoSource).toContain("parseStoredSettings(window.localStorage.getItem(STORAGE_KEY)");
    expect(logoSource).toContain("parsed.src");
    expect(logoSource).toContain("hasLoadedSettings");
    expect(logoSource).toContain("src={current.src}");
    expect(logoSource).toContain("Drop Logo Image Here");
    expect(logoSource).toContain("Choose Image");
    expect(logoSource).toContain("fileToDataUrl");
    expect(logoSource).not.toContain("Swap");
    expect(logoSource).not.toContain("Swap Logo Image");
    expect(logoSource).not.toContain("isSwapDropOpen");
  });

  it("keeps live preview controls for crop, resizing, and edge blending", () => {
    const logoSource = readFileSync(join(__dirname, "sidebar-logo-control.tsx"), "utf8");

    expect(logoSource).toContain("Live Preview");
    expect(logoSource).toContain("Horizontal Crop");
    expect(logoSource).toContain("Vertical Crop");
    expect(logoSource).toContain("Image Size");
    expect(logoSource).toContain("Logo Box Height");
    expect(logoSource).toContain('width: "auto"');
    expect(logoSource).toContain('transform: "translateX(-50%)"');
    expect(logoSource).not.toContain("Resize logo image from right edge");
    expect(logoSource).not.toContain("beginImageResize");
    expect(logoSource).not.toContain("renderResizeHandle");
    expect(logoSource).toContain("Edge Blend Width");
    expect(logoSource).toContain("Edge Opacity");
    expect(logoSource).toContain("--logo-edge-opacity");
    expect(logoSource).toContain("--logo-edge-stop");
  });
});