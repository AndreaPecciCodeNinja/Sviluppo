import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bird credentials stay server-side (Route Handlers). No rewrites needed.
  // Native SQLite binding used by local LangChain memory.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
