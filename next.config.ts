import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/offline/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};
export default nextConfig;
