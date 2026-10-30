/**
 * THE BILLING / USAGE READ-OUT FOR ONE ACCOUNT (Phase 8, block 5).
 *
 * Three sections, and each one is a query run on this request:
 *
 *   usage  — the account's own `UsageEvent` rows, written by the code paths
 *            that did the work. The synthetic half is counted from the row's own
 *            `synthetic` column, never inferred.
 *   ledger — the account's own `CreditLedgerEntry` rows, with the balance
 *            SUMMED from them (`summariseLedger`). There is no stored balance.
 *   plans  — `buildPlanCatalogue()`: today no plan exists, and the section says
 *            why in the words the probes produced, instead of drawing an empty
 *            grid.
 *
 * `buildBillingOverview()` is pure and takes its rows as arguments, so the whole
 * page can be tested without a database. `loadBillingOverview()` is the Prisma
 * half and is what the page and the API both call — one derivation, so the page
 * and the JSON cannot disagree.
 */
import { prisma } from "@/lib/db";
import { summariseLedger, type LedgerSummary } from "./ledger";
import { buildPlanCatalogue, OWNER_APPROVED_PLANS, scanForPaymentObjectCreation, type PlanCatalogue } from "./plans";
import { countLedgerEntries, countUsageEvents, prismaLedgerStore, prismaUsageStore } from "./store";
import { USAGE_KIND_LABEL, type LedgerEntryRecord, type UsageEventRecord } from "./types";

/** How many usage rows the page lists. The total is counted separately. */
export const BILLING_MAX_EVENTS = 50;
/** How many ledger rows the page lists. The balance is summed from ALL of them. */
export const BILLING_MAX_ENTRIES = 50;

export interface UsageLine {
  kind: UsageEventRecord["kind"];
  label: string;
  rows: number;
  quantity: number;
  synthetic: number;
}

export interface BillingOverview {
  generatedAt: string;
  account: { id: string; email: string };
  usage: {
    /** Counted in the database, not from the listed page. */
    total: number;
    synthetic: number;
    byKind: UsageLine[];
    recent: Array<{
      kind: UsageEventRecord["kind"];
      label: string;
      quantity: number;
      unit: string;
      outcome: string;
      synthetic: boolean;
      occurredAt: string;
      source: string;
      projectId: string | null;
      renderJobId: string | null;
      stageId: string | null;
    }>;
    /** Set only when the account has no usage row at all. */
    empty: string | null;
    /** Says how many rows are listed when the list is capped. */
    coverage: string;
  };
  ledger: {
    total: number;
    entries: Array<{
      kind: LedgerEntryRecord["kind"];
      amount: number;
      reason: string;
      occurredAt: string;
      usageEventId: string | null;
      /** True/False when the cause is a known usage row; null when it has none. */
      causedBySynthetic: boolean | null;
    }>;
    summary: LedgerSummary;
    /** Set only when the account has no ledger row at all. */
    empty: string | null;
    coverage: string;
  };
  plans: PlanCatalogue;
  /** Standing statements this page will not let a reader forget. */
  statements: string[];
}

export interface BillingFacts {
  generatedAt: string;
  account: { id: string; email: string };
  events: UsageEventRecord[];
  totalEvents: number;
  entries: LedgerEntryRecord[];
  totalEntries: number;
  plans: PlanCatalogue;
}

/** Pure: every figure below is counted from the rows handed in. */
export function buildBillingOverview(facts: BillingFacts): BillingOverview {
  const events = facts.events;
  const byKind: UsageLine[] = [];
  for (const [kind, label] of Object.entries(USAGE_KIND_LABEL) as Array<[UsageEventRecord["kind"], string]>) {
    const rows = events.filter((e) => e.kind === kind);
    if (rows.length === 0) continue; // a kind that never happened is absent, not a zero
    byKind.push({
      kind,
      label,
      rows: rows.length,
      quantity: rows.reduce((n, e) => n + e.quantity, 0),
      synthetic: rows.filter((e) => e.synthetic).length,
    });
  }
  const synthetic = events.filter((e) => e.synthetic).length;
  const summary = summariseLedger(facts.entries);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const coverage =
    facts.totalEvents > events.length
      ? `listing the ${events.length} most recent of ${facts.totalEvents} usage row(s); the counts above are from the whole account`
      : `listing all ${events.length} usage row(s) on this account`;

  return {
    generatedAt: facts.generatedAt,
    account: facts.account,
    usage: {
      total: facts.totalEvents,
      synthetic,
      byKind,
      recent: events.slice(0, BILLING_MAX_EVENTS).map((e) => ({
        kind: e.kind,
        label: USAGE_KIND_LABEL[e.kind],
        quantity: e.quantity,
        unit: e.unit,
        outcome: e.outcome,
        synthetic: e.synthetic,
        occurredAt: e.occurredAt.toISOString(),
        source: e.source,
        projectId: e.projectId ?? null,
        renderJobId: e.renderJobId ?? null,
        stageId: e.stageId ?? null,
      })),
      empty:
        facts.totalEvents === 0
          ? "No usage row exists for this account. Nothing here has been metered yet — this is an absence, not a usage " +
            "figure of zero, and nothing is drawn in its place."
          : null,
      coverage,
    },
    ledger: {
      total: facts.totalEntries,
      entries: facts.entries.slice(0, BILLING_MAX_ENTRIES).map((e) => ({
        kind: e.kind,
        amount: e.amount,
        reason: e.reason,
        occurredAt: e.occurredAt.toISOString(),
        usageEventId: e.usageEventId,
        causedBySynthetic: e.usageEventId ? (eventById.get(e.usageEventId)?.synthetic ?? null) : null,
      })),
      summary,
      empty:
        facts.totalEntries === 0
          ? "No ledger row exists for this account, so there is no balance and no charge to show. The page does not " +
            "print zero in its place: zero would be a measurement and nothing has been measured."
          : null,
      coverage:
        facts.totalEntries > facts.entries.length
          ? `listing the ${facts.entries.length} most recent of ${facts.totalEntries} ledger row(s); the balance is summed from the rows read here`
          : `listing all ${facts.entries.length} ledger row(s) on this account`,
    },
    plans: facts.plans,
    statements: [
      "Every figure on this page was computed on this request from rows in this database. Nothing is cached, and no balance is stored anywhere to be read.",
      "A synthetic row is not a customer's work: the encoder proofs on this build are declared synthetic, and the usage they create says so in its own column.",
      "Nothing on this page can be bought. There is no plan, no price and no payment provider on this deployment, and this page cannot report a subscription that no row supports.",
    ],
  };
}

export interface BillingDeps {
  usageStore?: { readUsageEvents(userId: string, take?: number): Promise<UsageEventRecord[]> };
  ledgerStore?: { readEntries(userId: string): Promise<LedgerEntryRecord[]> };
  countEvents?: (userId: string) => Promise<number>;
  countEntries?: (userId: string) => Promise<number>;
  planCatalogue?: () => Promise<PlanCatalogue>;
  now?: () => Date;
}

async function loadPlanFacts(): Promise<PlanCatalogue> {
  const providerLinkedSubscriptions = await prisma.subscription.count({ where: { provider: { not: null } } });
  return buildPlanCatalogue({
    stripeKeyPresent: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    productSourceHits: scanForPaymentObjectCreation(),
    providerLinkedSubscriptions,
    approvedPlans: OWNER_APPROVED_PLANS,
    envNamesChecked: ["STRIPE_SECRET_KEY"],
  });
}

/** The Prisma half. Called by the page AND by the API route. */
export async function loadBillingOverview(userId: string, deps: BillingDeps = {}): Promise<BillingOverview> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!account) throw new Error(`account ${userId} does not exist — no billing read-out to give`);
  const usageStore = deps.usageStore ?? prismaUsageStore;
  const ledgerStore = deps.ledgerStore ?? prismaLedgerStore;
  const [events, entries, totalEvents, totalEntries, plans] = await Promise.all([
    usageStore.readUsageEvents(userId, BILLING_MAX_EVENTS),
    ledgerStore.readEntries(userId),
    (deps.countEvents ?? countUsageEvents)(userId),
    (deps.countEntries ?? countLedgerEntries)(userId),
    (deps.planCatalogue ?? loadPlanFacts)(),
  ]);
  return buildBillingOverview({
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    account,
    events,
    totalEvents,
    entries,
    totalEntries,
    plans,
  });
}
