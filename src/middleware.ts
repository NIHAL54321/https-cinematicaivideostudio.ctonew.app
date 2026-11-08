import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Lightweight route protection (cookie presence only — the real session
 * verification happens server-side in the (app) layout via requireUser()).
 * Kept in the Edge runtime: no DB access, no heavy imports.
 */

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/create-video",
  "/projects",
  "/ai",
  "/brand-kit",
  "/media-library",
  "/export-center",
  "/settings",
];

const AUTH_PAGES = ["/signin", "/signup"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSessionCookie = req.cookies.has(SESSION_COOKIE);

  if (isProtected(pathname) && !hasSessionCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && hasSessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return withTransportSecurity(req, NextResponse.next());
}

/**
 * HSTS, but only when the request really arrived over TLS.
 *
 * This build is served over plain HTTP on :3100 with no TLS terminator in front,
 * and a browser ignores Strict-Transport-Security delivered over HTTP. Sending
 * it anyway would be a claim about a deployment that does not exist, so it is
 * added only when the request carries `x-forwarded-proto: https` (what a
 * terminator sets) or was itself https. The static headers — CSP, nosniff,
 * referrer policy, frame policy, Permissions-Policy — live in next.config.mjs
 * and apply to every path, including the API.
 */
function withTransportSecurity(req: NextRequest, res: NextResponse): NextResponse {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https" || req.nextUrl.protocol === "https:") {
    res.headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
