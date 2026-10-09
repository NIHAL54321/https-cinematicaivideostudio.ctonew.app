/**
 * The signed-out surfaces' copy — one owner for every claim a visitor reads.
 *
 * A visitor who is not signed in reads four things: the landing page
 * (`src/app/page.tsx`), the sign-in/sign-up panel
 * (`src/components/auth-layout.tsx`), the `<head>` metadata
 * (`src/app/layout.tsx`) and the unauthenticated health payload
 * (`src/app/api/health/route.ts`). Before this module existed each of those
 * carried its own prose, and the prose had drifted into claims that were false
 * when read: a stale hard-coded phase badge, "…and 4K export, all
 * from a single prompt", "AI voiceovers … tuned to your Brand Kit", and a `A → B
 * → C → D fallback` line that sold router code as a delivered capability.
 *
 * Three rules hold here, and `src/lib/product/__tests__/` enforces each:
 *
 *   1. BUILD FACTS ONLY. Every derived value (capability counts, the wired
 *      count, preset count, delivery formats, the length ceiling, the attempt
 *      limit) is read from the module that owns it. Nothing is hand-typed.
 *   2. NO MACHINE STATE. The landing page is prerendered at build time, so a
 *      value that depends on THIS machine's keys would freeze into the build and
 *      then contradict `/api/ai/status` the moment a key was added. This module
 *      therefore reads no env and takes live connectivity as an ARGUMENT
 *      (`dashboardProviderLine`) — the same discipline as
 *      `src/lib/ai/gate-wording.ts`.
 *   3. NO OUTPUT CLAIMS. No generative step in this product has ever produced a
 *      finished file, so no sentence here promises a delivered video, an encoded
 *      4K master, or a generation that ran. The copy describes the workspace,
 *      the export SPECIFICATION, and what the app does when a provider is
 *      missing.
 */
import { AI_CAPABILITIES } from "../ai/types";
import { capabilityEnvPath } from "../ai/providers/capability-env";
import { DEFAULT_ATTEMPTS_LIMIT } from "../ai/orchestrator";
import { EXPORT_FORMATS, EXPORT_PRESETS } from "../export/presets";
import { MAX_EXPORT_DURATION_SECONDS } from "../export/sizing";

export interface WiredReadout {
  /** How many AI capabilities this build declares (the registry's list). */
  capabilitiesTotal: number;
  /** How many of them have at least one slot with a real adapter. */
  capabilitiesWired: number;
  wiredCapabilities: string[];
  /** Slot ids that carry a real adapter for at least one capability. */
  wiredProviders: string[];
  providersTotal: number;
}

/**
 * The registry's own answer to "what is wired", derived per call from the
 * capability → slot table. No env, no cache, no count written by hand: wiring a
 * new adapter changes this readout with no edit to any page.
 */
export function wiredReadout(): WiredReadout {
  const wiredCapabilities: string[] = [];
  const wiredProviders = new Set<string>();
  for (const capability of AI_CAPABILITIES) {
    const path = capabilityEnvPath(capability);
    if (!path.hasWiredProvider) continue;
    wiredCapabilities.push(capability);
    for (const id of path.wiredProviderIds) wiredProviders.add(id);
  }
  return {
    capabilitiesTotal: AI_CAPABILITIES.length,
    capabilitiesWired: wiredCapabilities.length,
    wiredCapabilities,
    wiredProviders: [...wiredProviders],
    providersTotal: new Set(
      AI_CAPABILITIES.flatMap((c) => capabilityEnvPath(c).providerIds),
    ).size,
  };
}

/* ------------------------------------------------------------------ */
/* The hero                                                           */
/* ------------------------------------------------------------------ */

/**
 * The headline, in three pieces so the page can style the middle one. It states
 * what the studio COVERS (every stage has a surface) rather than what it has
 * produced — "A complete cinematic video" was the old promise and no encode has
 * ever run.
 */
export const HERO_HEADLINE = {
  before: "One idea. Every stage of a",
  accent: "cinematic video",
  after: ".",
};

/**
 * The wiring line on its own — the same derived counts wherever a surface
 * reports where the studio stands.
 */
export function wiringBadge(): string {
  const r = wiredReadout();
  return `${r.capabilitiesWired} of ${r.capabilitiesTotal} AI capabilities wired`;
}

/**
 * The badge above the headline. The qualitative half stays true as work
 * progresses; the counts are derived from the registry, so the sentence cannot
 * go stale the way "Phase 1 · Foundation is live" did.
 */
export function landingBadge(): string {
  return `In active development · ${wiringBadge()}`;
}

/** The one-sentence description of what the studio is for. */
export function studioSummary(): string {
  return (
    "The production workspace for faceless YouTube channels — script, storyboard, visuals, voice, " +
    "music, subtitles, thumbnail, SEO and the export specification, each one a real surface you work " +
    "in. Where a generative step has no connected provider, the studio says so rather than inventing output."
  );
}

/* ------------------------------------------------------------------ */
/* The feature cards                                                  */
/* ------------------------------------------------------------------ */

export interface PublicFeature {
  id: string;
  title: string;
  desc: string;
}

function joinList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** The widest delivery frame the export presets specify — 3840×2160 today. */
export function widestExportFrame(): { widthPx: number; heightPx: number; resolution: string } {
  const widest = [...EXPORT_PRESETS].sort((a, b) => b.widthPx - a.widthPx)[0];
  return { widthPx: widest.widthPx, heightPx: widest.heightPx, resolution: widest.resolution };
}

/** The 120-minute ceiling, in minutes, from the export sizing module. */
function maxExportMinutes(): number {
  return MAX_EXPORT_DURATION_SECONDS / 60;
}

export function publicFeatures(): PublicFeature[] {
  const frame = widestExportFrame();
  return [
    {
      id: "structure",
      title: "Idea to structure",
      desc:
        "One idea becomes a persisted plan — beat structure, scenes with durations, camera and visual " +
        "prompts. The script step is AI and reports its own provider status.",
    },
    {
      id: "delivery",
      title: "Delivery & export specifications",
      desc:
        `${EXPORT_PRESETS.length} export specifications across ${joinList(EXPORT_FORMATS)} — up to ` +
        `${frame.resolution} (4K) and a ${maxExportMinutes()}-minute length ceiling. The encode itself is a ` +
        "handoff to a provider you connect; this app has no encoder of its own.",
    },
    {
      id: "lock-in",
      title: "No provider lock-in",
      desc:
        "Every step is ranked across the provider accounts that can serve it, and a failed attempt falls " +
        `through to the next ranked provider — up to ${DEFAULT_ATTEMPTS_LIMIT}. Nothing is attempted until ` +
        "its adapter is wired and its key is set.",
    },
    {
      id: "audio",
      title: "Voice, music & sound",
      desc:
        "Voice catalogue, Voice Director, pronunciation and sync; music selection with ducking; sound " +
        "design. Those engines are deterministic; each generative step is provider-backed and reports " +
        "whether it is connected.",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* The sign-in / sign-up panel                                        */
/* ------------------------------------------------------------------ */

export function authPanelBullets(): string[] {
  const r = wiredReadout();
  return [
    `${r.capabilitiesWired} of ${r.capabilitiesTotal} AI capabilities have a wired adapter — every other step reports its own provider status`,
    "Brand Kit seeded into every new project",
    "Auto-save with full version history",
  ];
}

/* ------------------------------------------------------------------ */
/* The "honest by design" section                                     */
/* ------------------------------------------------------------------ */

export const HONEST_EYEBROW = "Honest by design";
export const HONEST_HEADING = "No fake AI. Ever.";

/**
 * The policy sentence. It describes BEHAVIOUR (what the app does when a step has
 * no connected provider) rather than this server's state, so it is true whether
 * or not a key is present — and it can be rendered from a build-time page.
 */
export const HONEST_BODY =
  "A capability is wired when a real provider adapter exists for it, and connected when that provider's " +
  "key is on the server. The app reports both, per capability, and names the environment variable a key " +
  "would go in. A step with no connected provider says exactly that; nothing is simulated.";

/** The footnote the phase/roadmap line used to occupy. */
export function honestFootnote(): string {
  const r = wiredReadout();
  return (
    `Wired today: ${r.capabilitiesWired} of ${r.capabilitiesTotal} AI capabilities. A provider's own answer ` +
    "is recorded exactly as the provider gave it — successes and failures alike."
  );
}

/* ------------------------------------------------------------------ */
/* Metadata, health, dashboard                                        */
/* ------------------------------------------------------------------ */

/** The `<head>` description shipped with every page. */
export const PAGE_DESCRIPTION =
  "The production workspace for faceless YouTube videos — script, storyboard, visuals, voice, music, " +
  "subtitles, thumbnail, SEO and the export specification. The AI steps run on provider accounts you " +
  "connect, and the app reports which are connected.";

/** The public /api/health payload's AI section. Never a phase number. */
export function healthAiReadout(): { capabilities: number; wiredCapabilities: number } {
  const r = wiredReadout();
  return { capabilities: r.capabilitiesTotal, wiredCapabilities: r.capabilitiesWired };
}

/**
 * The dashboard's services line. `connected` is passed in from the live capability
 * status the caller read — the caller reads env, this module never does — so the
 * signed-in dashboard can state this server's real state without the sentence
 * being hard-coded to one machine.
 */
export function dashboardProviderLine(connected: number): string {
  const r = wiredReadout();
  if (connected > 0) {
    return `AI providers — ${connected} of ${r.capabilitiesTotal} capabilities connected on this server`;
  }
  return `AI providers — ${r.capabilitiesWired} of ${r.capabilitiesTotal} capabilities have a wired adapter; none connected on this server yet`;
}
