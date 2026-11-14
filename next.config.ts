import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Required for @xyflow/react server components
  },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
