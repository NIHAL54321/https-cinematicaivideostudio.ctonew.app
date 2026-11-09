/**
 * OWNER AUTO SIGN-IN — the gate, and nothing else (Phase 8, owner-session block).
 *
 * WHAT THIS IS: one named account can be signed in automatically on a deployment
 * whose only user is the owner, so that signing in stops being a step. It is
 * NOT authentication removed. Every API route in this app resolves a real
 * `userId` from a real `Session` row, the security block proved anonymous access
 * is 401 on all 55 of them, and tenancy is 404-never-403. Deleting the session
 * layer would break all of that and could not be undone cheaply, so instead the
 * app mints a REAL session for a REAL user row when, and only when, an
 * environment variable names that user.
 *
 * WHY THIS FILE IMPORTS NOTHING: it is read from three places — the Node
 * instrumentation hook at startup, the Node route handler that mints, and the
 * server components that show the marker. Keeping it free of Prisma, of
 * `next/headers` and of every other module means none of those call sites drag
 * anything into a bundle it should not, and it can be unit-tested with a plain
 * object instead of a database.
 *
 * THE ENV READ IS LAZY, PER CALL. `process.env` is read inside the function, not
 * captured at module load, so a test (or an operator restarting the process) can
 * change it and see the change. It also means the gate cannot be frozen into the
 * build by an import-time constant.
 */

export type OwnerGateOffReason =
  | "CAVS_OWNER_EMAIL is not set"
  | "CAVS_OWNER_EMAIL is empty"
  | "CAVS_OWNER_AUTOLOGIN=0"
  | "CAVS_OWNER_EMAIL is not an email address";

export interface OwnerGate {
  /** True only when the env names an account AND nothing has forced it off. */
  enabled: boolean;
  /** The normalised (trimmed, lower-cased) address the flag names, "" when unset. */
  email: string;
  /** Why the gate is on or off, in words, so a surface never has to guess. */
  reason: string;
}

/** Deliberately loose: one "@" with something either side, no whitespace. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Reads the flag. The ONLY input is the environment:
 *
 *   CAVS_OWNER_EMAIL       set to an address  -> auto sign-in for that account
 *                          unset or empty     -> today's behaviour, unchanged
 *   CAVS_OWNER_AUTOLOGIN   "0"                -> force off without unsetting
 *
 * NODE_ENV is never consulted. A build that enabled this because it happened to
 * be running in production is exactly the accident this must not allow: the flag
 * has to be a deliberate, named act on one deployment.
 */
export function ownerAutoLoginGate(env: NodeJS.ProcessEnv = process.env): OwnerGate {
  const raw = (env.CAVS_OWNER_EMAIL ?? "").trim();
  const email = raw.toLowerCase();

  if (raw === "") {
    return { enabled: false, email: "", reason: "CAVS_OWNER_EMAIL is not set" };
  }
  if ((env.CAVS_OWNER_AUTOLOGIN ?? "").trim() === "0") {
    return { enabled: false, email, reason: "CAVS_OWNER_AUTOLOGIN=0" };
  }
  if (!EMAIL_SHAPE.test(email)) {
    return { enabled: false, email, reason: "CAVS_OWNER_EMAIL is not an email address" };
  }
  return { enabled: true, email, reason: "CAVS_OWNER_EMAIL names this account" };
}

/** True when a request path is one the mint route will send the caller to. */
export function safeOwnerNextPath(next: string | null | undefined): string {
  if (!next) return "/dashboard";
  // Same-origin, absolute path only. "//host" and "/\host" are treated as
  // external by browsers, and an absolute URL would make this route an open
  // redirect — which is a worse hole than the step it saves.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  if (next.includes("://")) return "/dashboard";
  // The sign-in page itself would bounce back here; the point is to leave it.
  if (next === "/signin" || next.startsWith("/signin?") || next === "/") return "/dashboard";
  return next;
}

/**
 * The one line the server prints at startup when the flag is on. It is not a
 * log for the operator to decode later: it states, in the log, that anyone who
 * can reach this server IS this account.
 */
export function ownerAutoLoginStartupWarning(email: string): string {
  return (
    `[owner-session] WARNING — OWNER AUTO SIGN-IN IS ON for ${email}. ` +
    `Anyone who can reach this server is signed in as that account and sees everything it owns. ` +
    `This is a deliberate reversal of "anonymous is 401" for THIS deployment only; ` +
    `unset CAVS_OWNER_EMAIL (or set CAVS_OWNER_AUTOLOGIN=0) before the app is reachable by anyone else.`
  );
}

/** The marker the app chrome shows, so the state is visible rather than silent. */
export function ownerSessionMarkerText(email: string): string {
  return `Owner session — sign-in bypassed for ${email}`;
}

/**
 * What /settings says about sign-out while the flag is on. Sign-out still works
 * (it deletes the session row and clears the cookie); the next request simply
 * mints a fresh one. Saying so is the difference between "working as designed"
 * and "the sign-out button is broken".
 */
export function ownerSessionSignOutNote(email: string): string {
  return (
    `Owner auto sign-in is on for ${email}. Signing out really does end this session — ` +
    `the session row is deleted and the cookie is cleared — but while CAVS_OWNER_EMAIL is set ` +
    `the next page you open signs you straight back in. To sign out for real, unset ` +
    `CAVS_OWNER_EMAIL (or set CAVS_OWNER_AUTOLOGIN=0) and restart the server.`
  );
}
