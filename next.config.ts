import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mermaid"],
  experimental: {
    optimizeCss: true,
    optimizeServerReact: true,
  },
};

export default nextConfig;
