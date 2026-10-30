/**
 * THE OPERATOR SURFACE IS GUARDED IN ONE PLACE, AND IT 404s (Phase 8, block 4).
 *
 * The live proof (a real second account getting 404, and an anonymous caller
 * getting 401) is in the evidence pack; these tests are the part that keeps the
 * shape of the guard from being edited away between runs:
 *
 *   - the API route refuses BEFORE it loads anything, so a refusal can never be
 *     a partial object;
 *   - the page and the API both go through `@/lib/admin/guard`, so there is one
 *     decision about who is an operator and not two;
 *   - the refusal is 404, and no file under the admin surface contains a 403;
 *   - no operator's email address is written in code — the grant is a script;
 *   - the nav entry is marked admin-only, so an ordinary account is not offered
 *     a link it would only get a 404 from.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ADMIN_FILES = walk(join(ROOT, "lib", "admin"))
  .concat([join(ROOT, "app", "(app)", "admin", "page.tsx")])
  .concat(walk(join(ROOT, "app", "api", "studio", "admin")))
  .map((full) => ({ rel: relative(ROOT, full), src: readFileSync(full, "utf8") }));

describe("the API route and the page share one guard", () => {
  test("the route refuses before it loads, and both go through the guard module", () => {
    const route = read("app/api/studio/admin/overview/route.ts");
    expect(route).toContain("@/lib/admin/guard");
    expect(route).toContain("@/lib/admin/overview");
    // The refusal must come first INSIDE THE HANDLER: a loader call before the
    // guard could return a partial object to a caller who is about to be refused.
    const routeBody = route.slice(route.indexOf("export async function GET"));
    expect(routeBody).toContain("requireAdminApiUser()");
    expect(routeBody.indexOf("requireAdminApiUser()")).toBeLessThan(routeBody.indexOf("loadAdminOverview("));

    const page = read("app/(app)/admin/page.tsx");
    expect(page).toContain("@/lib/admin/guard");
    expect(page).toContain("@/lib/admin/overview");
    const pageBody = page.slice(page.indexOf("export default async function"));
    expect(pageBody.indexOf("requireAdminPage()")).toBeLessThan(pageBody.indexOf("loadAdminOverview("));
  });

  test("the guard's refusal is 404 and the word 403 appears nowhere in the surface", () => {
    const guard = read("lib/admin/guard.ts");
    expect(guard).toContain("ApiError(404");
    expect(guard).toContain("notFound()");
    // Comments may explain why a 403 is wrong; CODE may not contain one.
    const offenders = ADMIN_FILES.filter((f) =>
      /\b403\b/.test(f.src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test("the guard reads the role from the account's row on every request", () => {
    const guard = read("lib/admin/guard.ts");
    expect(guard).toContain("prisma.user.findUnique");
    expect(guard).toContain("role: true");
    expect(guard).toContain('ADMIN_ROLE = "ADMIN"');
  });
});

describe("no operator is hard-coded in code", () => {
  test("no file under the admin surface contains an email address", () => {
    const offenders = ADMIN_FILES.filter((f) => /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(f.src)).map(
      (f) => f.rel,
    );
    expect(offenders).toEqual([]);
  });

  test("the grant is a script, and it takes the address as an argument", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "fixtures", "grant-admin.ts"), "utf8");
    expect(script).toContain("process.argv");
    expect(script).toContain("ADMIN");
    // Not even an example address: a fixture address in a comment is one copy
    // and paste away from being the grant.
    expect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(script)).toBe(false);
  });
});

describe("the nav offers the surface only to an operator", () => {
  test("the Admin item is marked adminOnly and the sidebar filters on it", () => {
    const constants = read("lib/constants.ts");
    expect(constants).toMatch(/href: "\/admin", label: "Admin", icon: ShieldCheck, adminOnly: true/);
    const sidebar = read("components/sidebar.tsx");
    expect(sidebar).toContain("adminOnly");
    expect(sidebar).toContain("isAdmin");
  });
});
