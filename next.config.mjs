/**
 * Response security headers (Phase 8, security block).
 *
 * WHY HERE AND NOT IN THE ROUTES: a header set in a route protects that route.
 * These are set for every path the server answers — pages, route handlers and
 * the static chunks — so there is one place to read and no route that quietly
 * forgot. A probe on 2026-11-06 found the app sending NONE of them: no CSP, no
 * nosniff, no referrer policy, no frame policy.
 *
 * THE CSP IS WRITTEN FOR THIS BUILD, NOT COPIED. Next streams its own bootstrap
 * as an inline <script> and Tailwind arrives partly as inline style, so a policy
 * without 'unsafe-inline' breaks every page. A nonce-based policy would be
 * tighter and needs middleware to mint the nonce per request; that is a larger
 * change than this block, and a CSP that breaks the editor is worse than the one
 * written here. What the policy DOES buy is real: no external script origin at
 * all, no framing (frame-ancestors 'none' + X-Frame-Options DENY), no <object>,
 * no base-tag rewriting, and forms can only post back to this origin.
 *
 * HSTS is deliberately NOT here. This build is served over plain HTTP on
 * 127.0.0.1:3100 with no TLS terminator, and a browser ignores
 * Strict-Transport-Security delivered over HTTP — sending it would be a claim
 * about a deployment that does not exist. src/middleware.ts sends it when a
 * request actually arrives with x-forwarded-proto: https, so the day a
 * terminator is put in front the header appears without a rebuild.
 */

const CSP = [
  "default-src 'self'",
  // Next's inline bootstrap. Nonce-based would be tighter; see the note above.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Provider thumbnails and previews come from an https CDN; user uploads come
  // back as signed URLs from the object store on this machine.
  "img-src 'self' data: blob: https: http://127.0.0.1:* http://localhost:*",
  "media-src 'self' data: blob: https: http://127.0.0.1:* http://localhost:*",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:*",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages: never bundled by webpack (avoids optional-dep
  // resolution errors like @valkey/valkey-glide and keeps bundles lean).
  serverExternalPackages: ["bullmq", "ioredis", "minio", "@prisma/client", ".prisma"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
