import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for production builds (Tailwind v4 CSS processing is more stable with webpack)
  // Dev still uses Turbopack for fast HMR
};

export default nextConfig;
