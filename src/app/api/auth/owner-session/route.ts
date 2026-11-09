import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { ownerAutoLoginGate, safeOwnerNextPath } from "@/lib/owner-session/gate";
import { mintOwnerSession } from "@/lib/owner-session/mint";
import { ownerSessionDeps } from "@/lib/owner-session/store";

/**
 * OWNER AUTO SIGN-IN — the mint route (Phase 8, owner-session block).
 *
 * WHY A ROUTE HANDLER AND NOT MIDDLEWARE: Prisma does not run on the edge
 * runtime, and middleware is edge. The gate can be *read* anywhere (it is pure
 * env), but creating a `Session` row and setting a cookie needs the Node
 * runtime, so the minting lives here and `runtime = "nodejs"` says so.
 *
 * WHAT IT DOES: when CAVS_OWNER_EMAIL names an account, this route signs the
 * caller into that account — through `createSession`, the same helper the
 * sign-in route uses — and redirects to the page they asked for. When the flag
 * is off it is a 401, exactly like every other API route called without a
 * session: there is no auto session to hand out, so you must sign in.
 *
 * WHAT IT IS NOT: it is not a bypass of tenancy. The session it mints belongs to
 * ONE real user row, found by its unique email. Every route downstream still
 * resolves `userId` from that session, and a foreign account still gets 404 for
 * this account's artefacts — the probe re-proves both.
 *
 * WHY IT REUSES A PRESENTED TOKEN: a browser that already holds a valid session
 * for this account must not accumulate a new `Session` row on every visit. The
 * probe and the unit tests both count rows to hold this to it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET(req: NextRequest) {
  const gate = ownerAutoLoginGate();
  const next = safeOwnerNextPath(req.nextUrl.searchParams.get("next"));

  // Off means off. This route is then just another API route without a session,
  // and it answers the way the whole app does: 401. The probe's anonymous sweep
  // runs with the flag unset and expects exactly this.
  if (!gate.enabled) {
    return NextResponse.json(
      { error: "Owner auto sign-in is not enabled on this deployment.", code: "owner_autologin_off", reason: gate.reason },
      { status: 401 },
    );
  }

  const outcome = await mintOwnerSession(ownerSessionDeps, {
    gate,
    presentedToken: req.cookies.get(SESSION_COOKIE)?.value ?? null,
    meta: { userAgent: req.headers.get("user-agent") ?? undefined, ip: clientIp(req) },
  });

  if (outcome.kind === "disabled") {
    // Unreachable while the gate read above and this read agree; kept so the
    // route cannot silently redirect on a state it did not check.
    return NextResponse.json(
      { error: "Owner auto sign-in is not enabled on this deployment.", code: "owner_autologin_off", reason: outcome.reason },
      { status: 401 },
    );
  }

  const res = NextResponse.redirect(new URL(next, req.url), 307);
  if (outcome.kind === "minted") {
    res.cookies.set(SESSION_COOKIE, outcome.token, sessionCookieOptions(outcome.expiresAt));
  }
  // No session value, no user id and no email in a URL or a body: the only thing
  // that leaves here is a Location and, when one was minted, a Set-Cookie.
  res.headers.set("cache-control", "no-store");
  return res;
}
