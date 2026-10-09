/**
 * The signed-out copy, held to a fact in this repository (BLOCK 10).
 *
 * `public-claims.test.ts` proves the old sentences are gone. This suite proves
 * the sentences that replaced them are true and DERIVED: every number a visitor
 * reads is recomputed here from the module that owns it, so hand-typing a count
 * into the copy fails the build rather than shipping a claim that rots.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AI_CAPABILITIES } from "../../ai/types";
import { capabilityEnvPath } from "../../ai/providers/capability-env";
import { providersFor } from "../../ai/providers/registry";
import { DEFAULT_ATTEMPTS_LIMIT } from "../../ai/orchestrator";
import { EXPORT_FORMATS, EXPORT_PRESETS } from "../../export/presets";
import { MAX_EXPORT_DURATION_SECONDS } from "../../export/sizing";
import {
  HERO_HEADLINE,
  HONEST_BODY,
  PAGE_DESCRIPTION,
  authPanelBullets,
  dashboardProviderLine,
  healthAiReadout,
  honestFootnote,
  landingBadge,
  publicFeatures,
  studioSummary,
  widestExportFrame,
  wiredReadout,
  wiringBadge,
} from "../public-copy";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const src = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** The claims this pass removed, in the shapes they must never return in. */
const BANNED_IN_COPY = [
  "Phase",
  "single prompt",
  "4K export",
  "AI voiceover",
  "tuned to your Brand Kit",
  "automatic fallback",
  "A → B → C → D",
  "complete cinematic",
];

describe("the readout is the registry's own answer", () => {
  test("capability counts match the registry, computed independently here", () => {
    const expectedWired = AI_CAPABILITIES.filter((c) =>
      providersFor(c).some((p) => p.isWired(c)),
    );
    const r = wiredReadout();
    expect(r.capabilitiesTotal).toBe(AI_CAPABILITIES.length);
    expect(r.capabilitiesWired).toBe(expectedWired.length);
    expect(r.wiredCapabilities).toEqual([...expectedWired]);
    // Every wired slot really is wired for a capability it advertises.
    for (const id of r.wiredProviders) {
      const slots = AI_CAPABILITIES.flatMap((c) => providersFor(c)).filter((p) => p.id === id);
      expect(slots.some((p) => p.capabilities.some((c) => p.isWired(c)))).toBe(true);
    }
  });

  test("the badge carries the derived counts and no phase number", () => {
    const r = wiredReadout();
    expect(wiringBadge()).toBe(`${r.capabilitiesWired} of ${r.capabilitiesTotal} AI capabilities wired`);
    expect(landingBadge()).toBe(`In active development · ${wiringBadge()}`);
    expect(landingBadge()).not.toMatch(/phase/i);
  });

  test("the health readout is the same derivation", () => {
    const r = wiredReadout();
    expect(healthAiReadout()).toEqual({
      capabilities: r.capabilitiesTotal,
      wiredCapabilities: r.capabilitiesWired,
    });
  });
});

describe("every sentence a visitor reads is true and derived", () => {
  test("the hero promises coverage, not output", () => {
    expect(HERO_HEADLINE.before).toBe("One idea. Every stage of a");
    expect(HERO_HEADLINE.accent).toBe("cinematic video");
    for (const part of Object.values(HERO_HEADLINE)) {
      for (const banned of BANNED_IN_COPY) expect(part).not.toContain(banned);
    }
  });

  test("the summary states where generations run and what happens without a provider", () => {
    const s = studioSummary();
    for (const banned of BANNED_IN_COPY) expect(s).not.toContain(banned);
    expect(s).toContain("export specification");
    expect(s).toContain("generative step");
  });

  test("the delivery card states the real preset count, formats, frame and ceiling", () => {
    const r = widestExportFrame();
    const widest = [...EXPORT_PRESETS].sort((a, b) => b.widthPx - a.widthPx)[0];
    expect(r.widthPx).toBe(widest.widthPx);
    expect(r.heightPx).toBe(widest.heightPx);
    expect(r.resolution).toBe(widest.resolution);
    expect(r.widthPx).toBeGreaterThanOrEqual(3840);

    const desc = publicFeatures().find((f) => f.id === "delivery")!.desc;
    expect(desc).toContain(`${EXPORT_PRESETS.length} export specifications`);
    for (const format of EXPORT_FORMATS) expect(desc).toContain(format);
    expect(desc).toContain(r.resolution);
    expect(desc).toContain(`${MAX_EXPORT_DURATION_SECONDS / 60}-minute length ceiling`);
    expect(desc).toContain("no encoder of its own");
    expect(desc).toContain("provider");
  });

  test("the lock-in card states the real attempt limit, and that nothing is attempted unwired", () => {
    const desc = publicFeatures().find((f) => f.id === "lock-in")!.desc;
    expect(desc).toContain(`up to ${DEFAULT_ATTEMPTS_LIMIT}`);
    expect(desc).toContain("its adapter is wired and its key is set");
  });

  test("the structure card describes the persisted plan, not an AI-written script", () => {
    const desc = publicFeatures().find((f) => f.id === "structure")!.desc;
    expect(desc).toContain("persisted plan");
    expect(desc).toContain("The script step is AI");
  });

  test("the audio card names the deterministic engines and labels the generative ones", () => {
    const desc = publicFeatures().find((f) => f.id === "audio")!.desc;
    expect(desc).toContain("Voice Director");
    expect(desc).toContain("ducking");
    expect(desc).toContain("deterministic");
    expect(desc).toContain("provider-backed");
  });

  test("no card, bullet or footnote carries a banned claim shape", () => {
    const texts = [
      ...publicFeatures().flatMap((f) => [f.title, f.desc]),
      ...authPanelBullets(),
      honestFootnote(),
      HONEST_BODY,
      PAGE_DESCRIPTION,
      studioSummary(),
    ];
    for (const text of texts) {
      for (const banned of BANNED_IN_COPY) expect(text).not.toContain(banned);
    }
  });

  test("the auth bullets and honest footnote carry the derived counts", () => {
    const r = wiredReadout();
    expect(authPanelBullets()[0]).toContain(`${r.capabilitiesWired} of ${r.capabilitiesTotal}`);
    expect(authPanelBullets().length).toBeGreaterThan(1);
    expect(honestFootnote()).toContain(`${r.capabilitiesWired} of ${r.capabilitiesTotal}`);
  });
});

describe("the dashboard line follows live state, both ways", () => {
  test("unkeyed and keyed readings differ and both are honest", () => {
    const r = wiredReadout();
    const none = dashboardProviderLine(0);
    const some = dashboardProviderLine(3);
    for (const line of [none, some]) {
      expect(line).not.toMatch(/phase/i);
      expect(line).toContain(`${r.capabilitiesTotal}`);
    }
    expect(some).toContain("3 of");
    expect(none).toContain("none connected on this server yet");
    expect(none).not.toBe(some);
  });
});

describe("the copy module can never freeze a machine's state into a build", () => {
  const ENV_FREE = [
    "src/lib/product/public-copy.ts",
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "src/components/auth-layout.tsx",
  ];

  for (const file of ENV_FREE) {
    test(`${file} reads no env and no live status`, () => {
      const text = src(file);
      expect(text).not.toContain("process.env");
      expect(text).not.toContain("capabilityStatus(");
      expect(text).not.toContain("lib/ai/status");
    });
  }
});
