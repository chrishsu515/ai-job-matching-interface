import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": ["./.env", "./.env.*", "./data/**/*", "./docs/evidence/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
