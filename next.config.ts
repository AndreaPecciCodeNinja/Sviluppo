import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bird credentials stay server-side (Route Handlers). No rewrites needed.
  // Keep native / package-exports modules out of the Turbopack server bundle.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
