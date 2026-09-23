import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ["mermaid"],
  experimental: {
    optimizeCss: true,
    optimizeServerReact: true,
  },
  allowedDevOrigins: ["localhost", "192.168.1.11", "10.1.4.28"],
  // "/" has no page of its own: redirect before anything renders (an in-app
  // navigation to a page that only calls redirect() could stall on a blank screen).
  async redirects() {
    return [{ source: "/", destination: "/chat", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
