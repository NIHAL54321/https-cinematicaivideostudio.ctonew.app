/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages: never bundled by webpack (avoids optional-dep
  // resolution errors like @valkey/valkey-glide and keeps bundles lean).
  serverExternalPackages: ["bullmq", "ioredis", "minio", "@prisma/client", ".prisma"],
};

export default nextConfig;
