/**
 * THE PLAN CATALOGUE IS DERIVED FROM FOUR PROBES, AND SAYS SO
 * (Phase 8, block 5).
 *
 * The page must not print a price or a plan. This file proves the OTHER half:
 * that the "no plan" sentence is not a hard-coded string either. Change one
 * probe and the sentence changes with it — including the case where a provider
 * key IS present, where the page must still refuse to claim a plan exists.
 */
import { describe, expect, test } from "bun:test";
import { buildPlanCatalogue, PLAN_SEAM, scanForPaymentObjectCreation, type PlanOffering } from "../plans";

const BASE = {
  stripeKeyPresent: false,
  productSourceHits: [] as string[],
  providerLinkedSubscriptions: 0,
  approvedPlans: [] as PlanOffering[],
  envNamesChecked: ["STRIPE_SECRET_KEY"],
};

const APPROVED: PlanOffering = {
  id: "test-plan",
  label: "A plan the owner approved in this test only",
  priceMinorUnits: 1900,
  currency: "USD",
  includes: "whatever the owner said it includes",
  approvedBy: "owner",
  approvedAt: "2026-10-30",
  providerProductId: null,
};

describe("today: no plan exists, and the reason is derived", () => {
  test("the catalogue is empty and the reason names each probe's own answer", () => {
    const catalogue = buildPlanCatalogue(BASE);
    expect(catalogue.plans).toEqual([]);
    expect(catalogue.purchasePossible).toBe(false);
    expect(catalogue.emptyReason).toContain("STRIPE_SECRET_KEY is not set in this process");
    expect(catalogue.emptyReason).toContain("no code path in this build creates a Stripe product");
    expect(catalogue.emptyReason).toContain("no subscription row carries a payment-provider id");
    expect(catalogue.emptyReason).toContain(PLAN_SEAM);
    expect(catalogue.seam).toBe(PLAN_SEAM);
  });

  test("the real repository is scanned, not asserted: no payment-object creation exists in src", () => {
    const hits = scanForPaymentObjectCreation();
    expect(hits).toEqual([]);
  });
});

describe("the sentence follows the facts", () => {
  test("a provider key present changes the sentence and still cannot make a plan purchasable", () => {
    const catalogue = buildPlanCatalogue({ ...BASE, stripeKeyPresent: true });
    expect(catalogue.plans).toEqual([]);
    expect(catalogue.purchasePossible).toBe(false);
    expect(catalogue.emptyReason).toContain("STRIPE_SECRET_KEY is present in this process");
    expect(catalogue.emptyReason).toContain("a key alone is not a product");
  });

  test("a payment path found changes that clause too", () => {
    const catalogue = buildPlanCatalogue({ ...BASE, productSourceHits: ["src/app/api/checkout/route.ts"] });
    expect(catalogue.emptyReason).toContain("a code path in this build creates a payment object");
    expect(catalogue.emptyReason).toContain("src/app/api/checkout/route.ts");
  });

  test("an approved plan removes the 'no plan' reason but is still NOT purchasable without a provider and a path", () => {
    const catalogue = buildPlanCatalogue({ ...BASE, approvedPlans: [APPROVED] });
    expect(catalogue.plans.length).toBe(1);
    expect(catalogue.emptyReason).toBeNull();
    expect(catalogue.purchasePossible).toBe(false);
  });

  test("purchasable requires ALL THREE: a plan, a provider key and a payment path", () => {
    const catalogue = buildPlanCatalogue({
      ...BASE,
      approvedPlans: [APPROVED],
      stripeKeyPresent: true,
      productSourceHits: ["src/app/api/checkout/route.ts"],
      providerLinkedSubscriptions: 1,
    });
    expect(catalogue.purchasePossible).toBe(true);
    expect(catalogue.facts).toMatchObject({
      stripeKeyPresent: true,
      providerLinkedSubscriptions: 1,
      approvedPlans: 1,
    });
  });
});
