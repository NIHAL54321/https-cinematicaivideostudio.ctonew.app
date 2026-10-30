/**
 * THE BILLING READ-OUT, BUILT FROM ROWS (Phase 8, block 5).
 *
 * `buildBillingOverview()` is pure, so this file can put a known set of rows in
 * front of it and check every figure — including the two absences the page must
 * state rather than draw: no usage rows, and no ledger rows.
 */
import { describe, expect, test } from "bun:test";
import { buildBillingOverview, type BillingFacts } from "../overview";
import { buildPlanCatalogue } from "../plans";
import type { LedgerEntryRecord, UsageEventRecord } from "../types";

const PLANS = buildPlanCatalogue({
  stripeKeyPresent: false,
  productSourceHits: [],
  providerLinkedSubscriptions: 0,
  approvedPlans: [],
  envNamesChecked: ["STRIPE_SECRET_KEY"],
});

const BASE: BillingFacts = {
  generatedAt: "2026-10-30T20:00:00.000Z",
  account: { id: "u1", email: "p7a-fixture@cavs.test" },
  events: [],
  totalEvents: 0,
  entries: [],
  totalEntries: 0,
  plans: PLANS,
};

function event(over: Partial<UsageEventRecord>): UsageEventRecord {
  return {
    id: "evt_1",
    userId: "u1",
    projectId: "p1",
    renderJobId: "j1",
    stageId: "encode-master",
    kind: "RENDER_STAGE_RUN",
    quantity: 1,
    unit: "stage run",
    outcome: "SUCCEEDED",
    synthetic: false,
    source: "src/lib/render/runner.ts",
    detail: null,
    occurredAt: new Date("2026-10-30T19:00:00.000Z"),
    ...over,
  } as UsageEventRecord;
}

function entry(over: Partial<LedgerEntryRecord>): LedgerEntryRecord {
  return {
    id: "led_1",
    userId: "u1",
    kind: "GRANT",
    amount: 100,
    reason: "development grant",
    usageEventId: null,
    occurredAt: new Date("2026-10-30T19:30:00.000Z"),
    ...over,
  } as LedgerEntryRecord;
}

describe("an account with no rows gets words, not zeroes", () => {
  test("usage and ledger are both stated as absent, and the balance is not reported", () => {
    const overview = buildBillingOverview(BASE);
    expect(overview.usage.empty).toContain("No usage row exists for this account");
    expect(overview.usage.byKind).toEqual([]);
    expect(overview.ledger.empty).toContain("No ledger row exists for this account");
    expect(overview.ledger.summary.known).toBe(false);
    expect(overview.ledger.summary.sentence).toContain("not a balance of zero");
    expect(overview.plans.plans).toEqual([]);
    expect(overview.plans.emptyReason).not.toBeNull();
  });
});

describe("the figures are counted from the rows", () => {
  test("by kind, synthetic half, and the derived balance", () => {
    const overview = buildBillingOverview({
      ...BASE,
      events: [
        event({ id: "e1", kind: "RENDER_JOB_CREATED", quantity: 1, synthetic: true }),
        event({ id: "e2", kind: "RENDER_STAGE_RUN", quantity: 1, synthetic: true }),
        event({ id: "e3", kind: "RENDER_STAGE_RUN", quantity: 1, synthetic: true }),
        event({ id: "e4", kind: "PROVIDER_CALL_ATTEMPT", quantity: 1, outcome: "FAILED", synthetic: false }),
      ],
      totalEvents: 4,
      entries: [
        entry({ id: "l1", kind: "GRANT", amount: 100, reason: "development grant" }),
        entry({ id: "l2", kind: "SPEND", amount: -3, reason: "fixture rate", usageEventId: "e2" }),
      ],
      totalEntries: 2,
    });
    expect(overview.usage.total).toBe(4);
    expect(overview.usage.synthetic).toBe(3);
    const kinds = overview.usage.byKind.map((k) => k.kind);
    expect(kinds).toEqual(["RENDER_JOB_CREATED", "RENDER_STAGE_RUN", "PROVIDER_CALL_ATTEMPT"]);
    const stages = overview.usage.byKind.find((k) => k.kind === "RENDER_STAGE_RUN");
    expect(stages).toMatchObject({ rows: 2, quantity: 2, synthetic: 2 });
    expect(overview.ledger.summary.balance).toBe(97);
    expect(overview.ledger.summary.known).toBe(true);
    // The spend's cause is a synthetic usage row, and the page can say so.
    const spend = overview.ledger.entries.find((e) => e.kind === "SPEND");
    expect(spend?.causedBySynthetic).toBe(true);
    const grant = overview.ledger.entries.find((e) => e.kind === "GRANT");
    expect(grant?.causedBySynthetic).toBeNull();
  });

  test("a capped list says so instead of looking like the whole account", () => {
    const events = Array.from({ length: 3 }, (_, i) => event({ id: `e${i}` }));
    const overview = buildBillingOverview({ ...BASE, events, totalEvents: 40, totalEntries: 0 });
    expect(overview.usage.coverage).toContain("listing the 3 most recent of 40 usage row(s)");
    expect(overview.usage.total).toBe(40);
  });

  test("the balance is summed from EVERY ledger row handed in, not from the listed page", () => {
    const entries = [entry({ id: "l1", amount: 10 }), entry({ id: "l2", amount: 5 })];
    const overview = buildBillingOverview({ ...BASE, entries, totalEntries: 2 });
    expect(overview.ledger.summary.balance).toBe(15);
    expect(overview.ledger.summary.rows).toBe(2);
  });
});
