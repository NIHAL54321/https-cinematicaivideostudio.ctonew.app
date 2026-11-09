/**
 * OWNER AUTO SIGN-IN — the wiring guards (Phase 8, owner-session block).
 *
 * The logic tests in owner-session.test.ts prove the decision. These prove the
 * decision is wired to the app the way the block requires, and that the things
 * that must NOT change did not:
 *
 *   1. THE SAME SESSION HELPER. The Prisma store's `createSession` IS
 *      `@/lib/auth`'s `createSession` — the function the sign-in route uses — so
 *      the token hashing, the TTL and the `Session` row are identical to a
 *      password sign-in. Compared by reference, not by reading a comment.
 *   2. THE SAME COOKIE FLAGS. Both routes that hand out a session use
 *      `sessionCookieOptions`, and neither types its own attributes — so
 *      HttpOnly/SameSite/Secure/Path cannot drift apart in a second copy.
 *   3. NO "FIRST USER" FALLBACK. The owner code looks an account up by its
 *      unique email and nothing else: no `findFirst`, no default account, no
 *      ordering. Tenancy is untouched.
 *   4. EDGE SAFETY. Middleware imports no Prisma and no store; the minting route
 *      declares the Node runtime.
 *   5. THE FLAG IS DOCUMENTED AND EMPTY in .env.example.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd());
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Strips comments so a guard cannot be satisfied by prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("the same session helper as a password sign-in", () => {
  test("prismaOwnerStore.createSession IS @/lib/auth's createSession", async () => {
    const { createSession } = await import("@/lib/auth");
    const { prismaOwnerStore } = await import("@/lib/owner-session/store");
    expect(prismaOwnerStore.createSession).toBe(createSession);
  });

  test("both session-issuing routes use sessionCookieOptions and type no attributes of their own", () => {
    for (const route of ["src/app/api/auth/signin/route.ts", "src/app/api/auth/owner-session/route.ts"]) {
      const src = code(read(route));
      expect(src).toContain("sessionCookieOptions(");
      // The five attributes live in ONE place (src/lib/auth.ts).
      expect(src).not.toContain("httpOnly:");
      expect(src).not.toContain("sameSite:");
      expect(src).not.toContain('path: "/"');
    }
  });

  test("the single definition carries the flags a sign-in session has", () => {
    const src = code(read("src/lib/auth.ts"));
    const block = src.slice(src.indexOf("export function sessionCookieOptions"));
    const body = block.slice(0, block.indexOf("\n}"));
    expect(body).toContain("httpOnly: true");
    expect(body).toContain('sameSite: "lax"');
    expect(body).toContain("secure: env.cookieSecure");
    expect(body).toContain('path: "/"');
    expect(body).toContain("expires: expiresAt");
  });
});

describe("tenancy is untouched", () => {
  test("the owner code never falls back to 'first user', 'any user' or a default account", () => {
    for (const file of [
      "src/lib/owner-session/mint.ts",
      "src/lib/owner-session/store.ts",
      "src/app/api/auth/owner-session/route.ts",
    ]) {
      const src = code(read(file));
      expect(src).not.toContain("findFirst");
      expect(src).not.toContain("findMany");
      expect(src).not.toContain("orderBy");
      expect(src).not.toContain("skip:");
    }
  });

  test("the account is looked up by its unique email", () => {
    const src = code(read("src/lib/owner-session/store.ts"));
    expect(src).toContain("findUnique({ where: { email }");
    // ...and the route takes the address from the gate, never from the request.
    const route = code(read("src/app/api/auth/owner-session/route.ts"));
    expect(route).toContain("ownerAutoLoginGate()");
    expect(route).not.toContain("searchParams.get(\"email\")");
  });

  test("the route does not read or trust a caller-supplied user id", () => {
    const route = code(read("src/app/api/auth/owner-session/route.ts"));
    expect(route).not.toContain("userId");
    expect(route).not.toContain("searchParams.get(\"userId\")");
  });
});

describe("runtime constraints", () => {
  test("middleware imports no Prisma and no owner store — it runs on the edge", () => {
    const src = code(read("src/middleware.ts"));
    expect(src).not.toContain("prisma");
    expect(src).not.toContain("@/lib/db");
    expect(src).not.toContain("owner-session/store");
    expect(src).not.toContain("owner-session/mint");
  });

  test("the gate module imports NOTHING, so every runtime can read it", () => {
    const src = read("src/lib/owner-session/gate.ts");
    const imports = src.match(/^\s*import\s/gm) ?? [];
    expect(imports.length).toBe(0);
  });

  test("the minting route declares the Node runtime and is never cached", () => {
    const src = code(read("src/app/api/auth/owner-session/route.ts"));
    expect(src).toContain('export const runtime = "nodejs"');
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });

  test("the sign-in page and the landing page read the gate per request", () => {
    for (const page of ["src/app/(auth)/signin/page.tsx", "src/app/page.tsx"]) {
      const src = code(read(page));
      expect(src).toContain("ownerAutoLoginGate()");
      expect(src).toContain('export const dynamic = "force-dynamic"');
    }
  });

  test("the startup warning is emitted from the instrumentation hook, guarded to the Node runtime", () => {
    const src = code(read("src/instrumentation.ts"));
    expect(src).toContain("register");
    expect(src).toContain("NEXT_RUNTIME");
    expect(src).toContain("ownerAutoLoginStartupWarning");
  });
});

describe("the flag is documented and empty", () => {
  test(".env.example documents both variables and sets neither", () => {
    const src = read(".env.example");
    expect(src).toContain("\nCAVS_OWNER_EMAIL=\n");
    expect(src).toContain("\nCAVS_OWNER_AUTOLOGIN=\n");
    // A documented example must not ship a value that turns this on.
    expect(/^CAVS_OWNER_EMAIL=\S/m.test(src)).toBe(false);
    expect(/^CAVS_OWNER_AUTOLOGIN=0/m.test(src)).toBe(false);
  });

  test("the marker is rendered from the shell, and only from a server-computed sentence", () => {
    const shell = code(read("src/components/app-shell.tsx"));
    expect(shell).toContain("OwnerSessionMarker");
    const layout = code(read("src/app/(app)/layout.tsx"));
    expect(layout).toContain("ownerSessionMarkerText");
    // The layout shows it only for the account the flag names.
    expect(layout).toContain("user.email === gate.email");
  });

  test("/settings explains that sign-out re-enters while the flag is on", () => {
    const settings = code(read("src/app/(app)/settings/page.tsx"));
    expect(settings).toContain("ownerSessionSignOutNote");
    expect(settings).toContain("ownerGate.email");
  });
});
