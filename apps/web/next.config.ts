import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Emit `.next/standalone`: a minimal server with only the files it needs, used by the
  // container image (apps/web/Dockerfile). Tracing starts at the monorepo root because pnpm
  // links dependencies from there.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: [...securityHeaders] }]);
  },
};

export default nextConfig;
