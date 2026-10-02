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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
