import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Article heroes reference YouTube's own thumbnail URLs directly via a plain
  // <img srcset>. We deliberately do NOT route them through next/image: the
  // optimiser would fetch and cache a derivative copy on our CDN, which is a
  // copy rather than a reference. See plan R29.
  images: {
    remotePatterns: [],
  },

  eslint: {
    // Linting runs as its own CI step; don't double-run it during build.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Typechecking runs as its own CI step.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
