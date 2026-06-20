import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("application security headers", () => {
  it("sets a conservative baseline on every route", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");

    expect(globalRule?.headers).toEqual(expect.arrayContaining([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" }
    ]));

    const csp = globalRule?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("marks API responses as private non-cacheable", async () => {
    const rules = await nextConfig.headers?.();
    const apiRule = rules?.find((rule) => rule.source === "/api/:path*");

    expect(apiRule?.headers).toEqual(expect.arrayContaining([
      { key: "Cache-Control", value: "private, no-store" }
    ]));
  });
});
