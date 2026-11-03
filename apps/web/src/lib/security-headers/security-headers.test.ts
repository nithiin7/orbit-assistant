import { contentSecurityPolicy, securityHeaders } from "./security-headers";

describe("securityHeaders", () => {
  it("forbids framing the app", () => {
    const names = securityHeaders.map((header) => header.key);

    expect(names).toContain("X-Frame-Options");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
  });

  it("doesn't restrict scripts or connections, which need deployment-specific URLs", () => {
    expect(contentSecurityPolicy).not.toMatch(/script-src|connect-src|default-src/);
  });

  it("has one value per header", () => {
    const names = securityHeaders.map((header) => header.key.toLowerCase());

    expect(new Set(names).size).toBe(names.length);
  });
});
