import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["odbc"],
  experimental: {
    agentUpgrade: "security",
  },
  // Client-side Convex auth does not fit Cache Components / instant nav.
  // Keep a classic App Router setup for this portal.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Prevent HMR full-reloads when the LAN ZK agent writes under zk-sync-agent/
  webpack: (config, { dev }) => {
    if (dev) {
      const ignored = ["**/zk-sync-agent/**", "**/.sync-state.json"];
      const prev = config.watchOptions?.ignored;
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
          ...ignored,
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
