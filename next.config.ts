import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    // typed builds are enforced — keep this on; CI runs `npm run build`
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
