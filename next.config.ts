import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cheerio and the optional AI SDKs are heavy server-only packages; keep them
  // out of the client bundle and let Next trace them on the server.
  serverExternalPackages: ["cheerio", "@anthropic-ai/sdk"],
  images: {
    // Audited pages can load images from any dealership/OEM domain.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
