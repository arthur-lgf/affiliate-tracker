/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // googleapis is a heavy node-only dep; keep it out of the bundler's way.
  serverExternalPackages: ['googleapis'],
};

export default nextConfig;
