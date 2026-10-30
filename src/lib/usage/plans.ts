/**
 * WHAT PLANS EXIST ON THIS DEPLOYMENT — DERIVED, AND TODAY: NONE.
 * (Phase 8, block 5)
 *
 * The billing page must not print a price, a plan name or a "credits included"
 * figure that nobody approved. So it does not hold one: it ASKS, on every
 * request, and prints what the answers say.
 *
 *   Q1. Is a payment provider configured?  `STRIPE_SECRET_KEY` read from this
 *       process, per call (the same probe the operator dashboard uses).
 *   Q2. Does any code path in this build create a Stripe product, price,
 *       payment link or checkout session?  A walk of `src/` for those calls.
 *   Q3. Does any subscription row carry a payment-provider id?  A count query
 *       run by the loader.
 *   Q4. Has the owner approved a plan?  `OWNER_APPROVED_PLANS` below.
 *
 * THE SEAM IS Q4. When the owner approves a price, the entry goes in
 * `OWNER_APPROVED_PLANS` and nowhere else, with the approval recorded on the
 * entry itself (who approved it and when). This array is deliberately empty and
 * a guard test asserts that it stays empty until someone changes it on purpose
 * — adding a plan is a business decision, not an engineering one, and an
 * engineering session that invented one would be fabricating a price.
 *
 * Even with an entry in that array, `purchasePossible` stays false until a
 * payment provider is configured AND a code path that can take a payment
 * exists. The page is built so it cannot say "buy" about something it cannot
 * sell.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A plan the owner has APPROVED. Nothing here is invented by this build: every
 * field is a decision that belongs to the owner, which is why the array below
 * is empty and why the shape insists on `approvedBy` and `approvedAt`.
 */
export interface PlanOffering {
  id: string;
  /** The name the owner chose. */
  label: string;
  /** The approved price, in the smallest currency unit, with the currency named. */
  priceMinorUnits: number;
  currency: string;
  /** What the approved plan includes, in the owner's words. */
  includes: string;
  /** Who approved this price and when — a plan with no approver is not a plan. */
  approvedBy: string;
  approvedAt: string;
  /** The provider's own product id, once one exists. */
  providerProductId?: string | null;
}

/**
 * THE SEAM. Empty on purpose: no price has been approved by the owner and no
 * Stripe product exists, so there is nothing a reader could buy. Editing this
 * array is how a price would enter the system — with `approvedBy` and
 * `approvedAt` filled in, because an unattributed price is a guess.
 */
export const OWNER_APPROVED_PLANS: readonly PlanOffering[] = [];

export interface PlanFacts {
  /** `Boolean(process.env.STRIPE_SECRET_KEY?.trim())`, read per call. */
  stripeKeyPresent: boolean;
  /** Files under `src/` that create a Stripe product/price/link/checkout. */
  productSourceHits: string[];
  /** `Subscription` rows carrying a payment-provider id. */
  providerLinkedSubscriptions: number;
  /** The owner-approved plans (see the seam above). */
  approvedPlans: readonly PlanOffering[];
  /** The env names that were probed, for the sentence. */
  envNamesChecked: string[];
}

export interface PlanCatalogue {
  /** Empty today. The page renders `emptyReason` rather than an empty grid. */
  plans: PlanOffering[];
  /** Null only when there is at least one plan to show. */
  emptyReason: string | null;
  /** True only when a plan exists AND a payment could actually be taken. */
  purchasePossible: boolean;
  /** Where an owner-approved price would be entered — printed on the page. */
  seam: string;
  facts: {
    stripeKeyPresent: boolean;
    productSourceHits: string[];
    providerLinkedSubscriptions: number;
    approvedPlans: number;
  };
}

/** The seam's location, in the words a person could act on. */
export const PLAN_SEAM = "src/lib/usage/plans.ts → OWNER_APPROVED_PLANS";

/**
 * Builds the catalogue from facts. Pure: the same facts always produce the same
 * sentences, and every clause below is a consequence of one of them.
 */
export function buildPlanCatalogue(facts: PlanFacts): PlanCatalogue {
  const plans = [...facts.approvedPlans];
  const providerConfigured = facts.stripeKeyPresent;
  const paymentPathExists = facts.productSourceHits.length > 0;
  const purchasePossible = plans.length > 0 && providerConfigured && paymentPathExists;

  const envNames = facts.envNamesChecked.join(", ") || "no environment variable names";
  const clauses: string[] = [];
  if (plans.length === 0) {
    clauses.push(
      `no plan is offered on this deployment because none has been approved: ${PLAN_SEAM} is empty, and this ` +
        "build does not invent a price",
    );
  }
  clauses.push(
    providerConfigured
      ? `${envNames} is present in this process, but a key alone is not a product: nothing has been created for it to sell`
      : `${envNames} is not set in this process, so this deployment cannot take a payment at all`,
  );
  clauses.push(
    paymentPathExists
      ? `a code path in this build creates a payment object (${facts.productSourceHits.join(", ")})`
      : "no code path in this build creates a Stripe product, price, payment link or checkout session",
  );
  clauses.push(
    facts.providerLinkedSubscriptions > 0
      ? `${facts.providerLinkedSubscriptions} subscription row(s) carry a payment-provider id`
      : "no subscription row carries a payment-provider id",
  );

  return {
    plans,
    emptyReason: plans.length === 0 ? `${clauses.join("; ")}.` : null,
    purchasePossible,
    seam: PLAN_SEAM,
    facts: {
      stripeKeyPresent: providerConfigured,
      productSourceHits: [...facts.productSourceHits],
      providerLinkedSubscriptions: facts.providerLinkedSubscriptions,
      approvedPlans: plans.length,
    },
  };
}

/**
 * Walks the app's own source for a call that would create a payment object. A
 * payment surface would have to live in `src/` to run, so finding none there is
 * a fact about this build rather than an assertion about intent.
 */
export function scanForPaymentObjectCreation(root = process.cwd()): string[] {
  const hits: string[] = [];
  const pattern = /\b(products|prices|paymentLinks|checkout\.sessions|subscriptions)\.create\s*\(/;
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        let body = "";
        try {
          body = readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (/stripe/i.test(body) && pattern.test(body)) {
          hits.push(full.slice(root.length + 1));
        }
      }
    }
  };
  walk(join(root, "src"), 0);
  return hits;
}
