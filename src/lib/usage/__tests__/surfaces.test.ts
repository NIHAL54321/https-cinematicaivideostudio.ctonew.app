/**
 * THE BILLING SURFACE'S SHAPE (Phase 8, block 5).
 *
 * The live proof (a real account reading its own rows, and an anonymous caller
 * getting 401) is in the evidence pack. These tests keep the shape from being
 * edited away between runs:
 *
 *   - the page and the API both refuse BEFORE they load anything;
 *   - both call the SAME loader, so the page and the JSON cannot disagree;
 *   - neither the page, the component nor the route contains a payment call —
 *     there is no path in this block that can take money;
 *   - the nav offers the page, and the operator dashboard carries the new
 *     section, counted with queries rather than typed in.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/**
 * The ORDER of two calls is a fact about code, not about prose: a doc comment
 * that mentions `loadBillingOverview()` must not decide whether the guard runs
 * first. Comments are stripped before the comparison.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const PAGE = "src/app/(app)/billing/page.tsx";
const ROUTE = "src/app/api/studio/billing/route.ts";
const COMPONENT = "src/components/billing-overview.tsx";

describe("the page and the API refuse first and derive once", () => {
  test("the page authenticates before it loads", () => {
    const page = code(PAGE);
    expect(page.indexOf("requireUser()")).toBeGreaterThan(-1);
    expect(page.indexOf("requireUser()")).toBeLessThan(page.indexOf("loadBillingOverview("));
  });

  test("the route authenticates before it loads, and answers no-store", () => {
    const route = code(ROUTE);
    expect(route.indexOf("requireApiUser()")).toBeLessThan(route.indexOf("loadBillingOverview("));
    expect(route).toContain("private, no-store");
    expect(route).toContain("apiError(err)");
  });

  test("the page and the route call the same loader — one derivation, not two", () => {
    expect(read(PAGE)).toContain('from "@/lib/usage/overview"');
    expect(read(ROUTE)).toContain('from "@/lib/usage/overview"');
  });
});

describe("there is no payment path in this block", () => {
  test("no billing surface file touches a payment provider", () => {
    for (const rel of [PAGE, ROUTE, COMPONENT]) {
      const src = read(rel).toLowerCase();
      expect(src.includes("stripe")).toBe(false);
      expect(src.includes("checkout")).toBe(false);
      expect(src.includes("paymentlink")).toBe(false);
    }
  });

  test("nothing in the source writes a subscription row", () => {
    // A plan or a paid status can only be claimed from a row; this block creates
    // none, so a subscription write anywhere would be a fabricated sale.
    const sources = [PAGE, ROUTE, COMPONENT, "src/lib/usage/overview.ts", "src/lib/usage/plans.ts"];
    for (const rel of sources) {
      const src = read(rel);
      expect(/subscription\.(create|update|upsert|delete)/.test(src)).toBe(false);
    }
  });

  test("the component renders the derived reason rather than an empty plan grid", () => {
    const component = read(COMPONENT);
    expect(component).toContain("plans.emptyReason");
    expect(component).toContain("No plan can be purchased on this deployment");
    expect(component).toContain("plans.seam");
  });
});

describe("the surface is reachable and the operator dashboard shows the counts", () => {
  test("the nav offers /billing", () => {
    const nav = read("src/lib/constants.ts");
    expect(nav).toContain('href: "/billing"');
  });

  test("the operator overview counts usage rows and ledger rows with queries", () => {
    const overview = read("src/lib/admin/overview.ts");
    expect(overview).toContain("prisma.usageEvent.count()");
    expect(overview).toContain("prisma.usageEvent.count({ where: { synthetic: true } })");
    expect(overview).toContain("prisma.creditLedgerEntry.count()");
    expect(overview).toContain('prisma.creditLedgerEntry.groupBy({ by: ["kind"]');
    const vm = read("src/lib/admin/view-model.ts");
    expect(vm).toContain('id: "usage"');
    expect(vm).toContain("usageSection");
  });
});
