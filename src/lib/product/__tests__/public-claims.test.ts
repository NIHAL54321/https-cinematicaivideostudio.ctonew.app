/**
 * The signed-out surfaces' claim contract (BLOCK 10).
 *
 * A visitor who is not signed in reads exactly four things: the landing page,
 * the sign-in/sign-up brand panel, the <head> metadata shipped with every page,
 * and the unauthenticated /api/health payload. Every one of them used to carry
 * claims that were false on the day they were read:
 *
 *   - "Phase 1 · Foundation is live" — a hard-coded phase number, stale two
 *     phases ago, with no source a reader could check.
 *   - "...thumbnail, SEO and 4K export, all from a single prompt" — implies a
 *     one-prompt pipeline that produces a 4K file. No generative step has ever
 *     run to completion in this product.
 *   - "Voice & music studio — AI voiceovers, music and sound design tuned to
 *     your Brand Kit" — those capabilities have no wired provider at all.
 *   - "AI without the lock-in — ... A → B → C → D fallback" — the fallback loop
 *     exists in the router, but reads as a delivered capability.
 *   - "Up to 120 minutes ... 4K export when the pipeline lands" — the ceiling is
 *     a real export constant, the headline sold a duration the product has
 *     never delivered.
 *   - /api/health answered `phase: 1`.
 *
 * This suite is the net: it reads the surface SOURCES (so it fails on the old
 * copy, which is archived in evidence/) and refuses the return of a claim of
 * that shape. Whitespace is collapsed before matching, because prose in JSX
 * wraps across lines. Provenance comments (`//`, `/*`, `*`) are exempt from the
 * phase-number rule: "Phase 5 Block 1 — the editor page" is a fact about when a
 * file was written, not a statement to a reader, and is reported in the Block 10
 * evidence README rather than rewritten.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Everything a signed-out visitor can read, as source. */
const PUBLIC_SURFACES = [
  "src/app/page.tsx", // the landing page
  "src/app/layout.tsx", // the <head> metadata every page ships
  "src/components/auth-layout.tsx", // the sign-in / sign-up brand panel
  "src/app/api/health/route.ts", // the unauthenticated health payload
];

/** The two public pages plus the module that now owns their copy. */
const DERIVED_COPY_CONSUMERS = [
  "src/app/page.tsx",
  "src/components/auth-layout.tsx",
];

function source(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** Prose in JSX wraps; compare on single-spaced text. */
function flat(file: string): string {
  return source(file).replace(/\s+/g, " ");
}

/**
 * One entry per claim removed from a signed-out surface. `claim` is matched
 * against the whitespace-collapsed source, so it must be written the way it
 * reads, not the way it wrapped.
 */
const REMOVED_PUBLIC_CLAIMS: { surface: string; claim: string; why: string }[] = [
  {
    surface: "src/app/page.tsx",
    claim: "Phase 1 · Foundation is live",
    why: "a hard-coded phase number on a hero badge; Phases 1-6 are complete, so it was stale and unverifiable in the same breath",
  },
  {
    surface: "src/app/page.tsx",
    claim: "Built for the 7-phase roadmap",
    why: "an internal plan reference a visitor cannot check, pinned to a phase someone has to remember to update",
  },
  {
    surface: "src/app/page.tsx",
    claim: "all from a single prompt",
    why: "asserts one prompt produces a finished pipeline; no generative step has ever completed",
  },
  {
    surface: "src/app/page.tsx",
    claim: "A complete",
    why: "the hero promised a complete video as the product's output",
  },
  {
    surface: "src/app/page.tsx",
    claim: "Up to 120 minutes",
    why: "a duration headline sold next to a 4K-export promise; the real, derived fact is the export length ceiling",
  },
  {
    surface: "src/app/page.tsx",
    claim: "4K export",
    why: "no encode has ever produced a file; what exists is the export specification (a 3840x2160 preset) and a provider handoff",
  },
  {
    surface: "src/app/page.tsx",
    claim: "A → B → C → D",
    why: "the attempt chain is router code that has never fallen through a real provider",
  },
  {
    surface: "src/app/page.tsx",
    claim: "AI voiceovers, music and sound design tuned to your Brand Kit",
    why: "voice, music and SFX have no wired provider adapter at all",
  },
  {
    surface: "src/app/page.tsx",
    claim: "tuned to your Brand Kit",
    why: "the brand kit seeds projects; it does not tune the voice or music engines",
  },
  {
    surface: "src/app/layout.tsx",
    claim: "complete cinematic faceless YouTube video",
    why: "the <head> description promised a completed video as the product's output",
  },
  {
    surface: "src/app/layout.tsx",
    claim: "and 4K export",
    why: "same class as the hero: an export promise in the shipped metadata",
  },
  {
    surface: "src/components/auth-layout.tsx",
    claim: "Phase 1 · Foundation",
    why: "stale hard-coded phase label on the sign-in and sign-up panel",
  },
  {
    surface: "src/components/auth-layout.tsx",
    claim: "Provider-independent AI with automatic fallback",
    why: "reads as a delivered capability; the fallback loop has never run against a real provider",
  },
  {
    surface: "src/components/auth-layout.tsx",
    claim: "Brand Kit that travels across every video",
    why: "the code seeds a new project's settings from the kit — the sentence claimed more than that",
  },
  {
    surface: "src/components/auth-layout.tsx",
    claim: "up to 120 minutes",
    why: "the ceiling is real but was stated as a headline promise about delivered length",
  },
  {
    surface: "src/components/auth-layout.tsx",
    claim: "4K export",
    why: "same class as the landing hero: no encode has ever produced a file",
  },
  {
    surface: "src/app/api/health/route.ts",
    claim: "phase: 1",
    why: "a hard-coded phase number in a public payload; nothing reads it and it was wrong",
  },
];

describe("signed-out surfaces — every removed claim stays removed", () => {
  for (const { surface, claim, why } of REMOVED_PUBLIC_CLAIMS) {
    test(`${surface} no longer says "${claim}" (${why})`, () => {
      expect(flat(surface)).not.toContain(claim);
    });
  }
});

describe("signed-out surfaces — no phase number, in any form", () => {
  for (const surface of PUBLIC_SURFACES) {
    test(`${surface} carries no Phase <n> label`, () => {
      const matches = flat(surface).match(/Phase\s*\d/gi) ?? [];
      expect(matches).toEqual([]);
    });
  }

  test("the health payload reads the derived capability readout instead", () => {
    expect(source("src/app/api/health/route.ts")).toContain("healthAiReadout(");
  });
});

describe("signed-out surfaces — the copy is owned by a derived module", () => {
  for (const consumer of DERIVED_COPY_CONSUMERS) {
    test(`${consumer} renders the shared copy module`, () => {
      expect(source(consumer)).toContain("@/lib/product/public-copy");
    });
  }
});

/**
 * The same defect class one click inside the app: a sentence that states THIS
 * server's or this build's status and cannot be true on another one. These were
 * user-visible strings, not comments.
 */
const REMOVED_APP_CLAIMS: { surface: string; claim: string; why: string }[] = [
  {
    surface: "src/app/(app)/dashboard/page.tsx",
    claim: "The 8-step Create Video wizard arrives in the next milestone",
    why: "false — the wizard is built, reachable and verified",
  },
  {
    surface: "src/app/(app)/dashboard/page.tsx",
    claim: "AI providers — deliberately",
    why: "the services list claimed the AI providers were 'deliberately Not Connected (Phase 3+)' — false on a server with a key, and pinned to a stale phase",
  },
  {
    surface: "src/components/projects/project-list.tsx",
    claim: "The 8-step Create Video wizard arrives in a later milestone",
    why: "false — the wizard is built, reachable and verified",
  },
  {
    surface: "src/app/(app)/ai/script-writer/page.tsx",
    claim: "Phase 2 · final builder",
    why: "stale phase badge in a page header",
  },
  {
    surface: "src/app/(app)/ai/audio-mix/page.tsx",
    claim: "real audio rendering arrives in Phase 5",
    why: "stale phase promise; the code fact is that the mix engine produces a plan and no audio renderer exists",
  },
  {
    surface: "src/components/provider-not-connected.tsx",
    claim: "not wired up yet in Phase 1",
    why: "one adapter is wired; the phase reference is stale and the sentence is shown on every signed-in AI page",
  },
  {
    surface: "src/components/ai-capability-status.tsx",
    claim: "wired yet in Phase 1",
    why: "same stale phase claim, in the branch that runs when API keys ARE set",
  },
  {
    surface: "src/components/ai-capability-status.tsx",
    claim: "A → B → C → D",
    why: "the connected state sold the attempt chain as a delivered capability; it now describes the fall-through the router actually performs",
  },
];

describe("signed-in surfaces — the same claim shapes, cleaned", () => {
  for (const { surface, claim, why } of REMOVED_APP_CLAIMS) {
    test(`${surface} no longer says "${claim}" (${why})`, () => {
      expect(flat(surface)).not.toContain(claim);
    });
  }

  test("the dashboard's provider line is derived from live status, not typed", () => {
    const text = source("src/app/(app)/dashboard/page.tsx");
    expect(text).toContain("dashboardProviderLine(");
    expect(text).toContain("allCapabilityStatus()");
  });
});

/**
 * BLOCK 11 — the forward promises a signed-in user still read.
 *
 * A sentence of the shape "X arrives in a later milestone / phase" tells a
 * signed-in user that a plan exists behind the gap. This team has no committed
 * milestone plan, so that is a claim nobody can back. Every one of these is now a
 * present-tense statement about what THIS build does — and, where the work does
 * exist elsewhere in the app, which page owns it. Deliberately left alone:
 * provenance comments (`Phase 5 Block 1 — …`), the `src/workers/ai-worker.ts`
 * stub (its message refuses rather than claims) and the stale test NAME in
 * `src/lib/ai/__tests__/orchestrator.test.ts`.
 */
const REMOVED_FORWARD_PROMISES: { surface: string; claim: string; why: string }[] = [
  {
    surface: "src/components/projects/workspace.tsx",
    claim: "AI thumbnail generation arrives in a later milestone",
    why: "a promise about a future milestone; the Thumbnail Generator page exists and reports its own provider status",
  },
  {
    surface: "src/components/projects/workspace.tsx",
    claim: "coming in a later milestone",
    why: "the placeholder-tab heading promised a future milestone for tabs whose work the Export Center and the studios already cover",
  },
  {
    surface: "src/components/projects/workspace.tsx",
    claim: "arrive with the Voice Studio milestone",
    why: "same class: the Voice Studio page is built and reachable now",
  },
  {
    surface: "src/components/projects/workspace.tsx",
    claim: "arrive with the AI pipeline",
    why: "same class: captions are produced on the Subtitle Studio page today",
  },
  {
    surface: "src/app/(app)/settings/page.tsx",
    claim: "Profile editing and password changes arrive in a later phase",
    why: "the card reads the account and cannot change it; that is a fact about this build, not a future phase",
  },
  {
    surface: "src/app/(app)/settings/page.tsx",
    claim: "until Stripe is connected in a later phase",
    why: "a payment promise; no payment provider is connected and this build cannot move money",
  },
  {
    surface: "src/app/(app)/projects/[id]/editor/editor-client.tsx",
    claim: "frame preview of real media arrives in a later phase",
    why: "the preview draws timeline blocks in this build; a phase promise is not a behaviour statement",
  },
  {
    surface: "src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx",
    claim: "supplied by vision in a later phase",
    why: "the field takes region JSON the user supplies; the vision step reports its own provider status",
  },
  {
    surface: "src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx",
    claim: "Region detection arrives with provider-based vision in a later phase",
    why: "region detection is a provider-backed capability with a live status, not a scheduled milestone",
  },
  {
    surface: "src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx",
    claim: "provider transcription unlocks audio→subtitle in a later phase",
    why: "audio→subtitle is a provider-backed step; its own status is what a user should be told",
  },
  {
    surface: "src/app/api/studio/subtitles/route.ts",
    claim: "provider transcription unlocks audio→subtitle in a later phase",
    why: "the same note is returned in the API payload the Subtitle Studio renders",
  },
];

/** Every file this pass corrected — the scans below cover all of them. */
const BLOCK_11_SURFACES = [
  "src/components/projects/workspace.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/projects/[id]/editor/editor-client.tsx",
  "src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx",
  "src/app/api/studio/subtitles/route.ts",
  "src/lib/ai/providers/types.ts",
  "src/components/ai-tool-page.tsx",
  "src/components/create-video/magic.tsx",
];

/**
 * Two leftovers of the same claim shape Block 10 removed from a sibling file:
 * the letter-picture fallback chain and the phrase "automatic fallback". Both
 * rendered to a signed-in user on pages Block 10 never opened. Neither is a
 * forward promise, but both read as a delivered pipeline, so the same rule
 * applies — the real fact is the orchestrator's ranked attempt limit.
 */
const REMOVED_LEFTOVER_CLAIMS: { surface: string; claim: string; why: string }[] = [
  {
    surface: "src/components/ai-tool-page.tsx",
    claim: "A → B → C → D",
    why: "Block 10 removed this exact string from ai-capability-status.tsx and added it to the banned copy shapes; it survived on the eight AI Studio tool pages, which read the same to a user",
  },
  {
    surface: "src/components/create-video/magic.tsx",
    claim: "with automatic fallback",
    why: "the same phrase Block 10 struck from the sign-in panel; the router's real behaviour is a ranked chain with a derived attempt limit",
  },
];

describe("signed-in surfaces — leftovers of the Block 10 claim shapes", () => {
  for (const { surface, claim, why } of REMOVED_LEFTOVER_CLAIMS) {
    test(`${surface} no longer says "${claim}" (${why})`, () => {
      expect(flat(surface)).not.toContain(claim);
    });
  }

  test("the tool page's attempt chain is the derived limit, not a letter picture", () => {
    const text = flat("src/components/ai-tool-page.tsx");
    expect(text).toContain("up to {DEFAULT_ATTEMPTS_LIMIT} ranked providers, in order");
    expect(text).toContain('from "@/lib/ai/orchestrator"');
  });

  test("the magic-create page describes the ranked chain instead", () => {
    expect(flat("src/components/create-video/magic.tsx")).toContain(
      "falls through to the next ranked one when an attempt fails",
    );
  });
});

/**
 * Lines that are not comments. Anything on one of these reaches a reader (JSX
 * text or a string literal), so a phase number or a milestone promise there is
 * an offender. Mirrors the comment detection the phase scan above uses.
 */
function nonCommentLines(file: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source(file).split("\n")) {
    const trimmed = line.trim();
    const isComment =
      inBlock || ["//", "/*", "*", "{/*"].some((m) => trimmed.startsWith(m));
    if (trimmed.includes("/*") && !trimmed.includes("*/")) inBlock = true;
    else if (inBlock && trimmed.includes("*/")) inBlock = false;
    if (!isComment) out.push(trimmed);
  }
  return out;
}

describe("signed-in surfaces — no forward promise survives", () => {
  for (const { surface, claim, why } of REMOVED_FORWARD_PROMISES) {
    test(`${surface} no longer says "${claim}" (${why})`, () => {
      expect(flat(surface)).not.toContain(claim);
    });
  }

  test("no non-comment line on a corrected surface promises a later milestone", () => {
    const offenders: string[] = [];
    for (const file of BLOCK_11_SURFACES) {
      for (const line of nonCommentLines(file)) {
        if (/later phase|later milestone|next milestone|coming soon/i.test(line)) {
          offenders.push(`${file}: ${line.slice(0, 110)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the runtime ProviderNotWiredError carries no phase number either", () => {
    expect(flat("src/lib/ai/providers/types.ts")).toContain(
      "no API integration is wired for it in this build",
    );
  });
});

describe("signed-in surfaces — the replacements state behaviour this build honours", () => {
  test("the workspace tabs say what this build does and which page owns the work", () => {
    const text = flat("src/components/projects/workspace.tsx");
    expect(text).toContain("no panel on this tab in this build");
    expect(text).toContain("Voice Studio, Music Studio and Sound Effects pages");
    expect(text).toContain("Subtitle Studio page");
    expect(text).toContain("Thumbnail Generator page");
    expect(text).toContain("Export Center page");
  });

  test("the settings panel states what it cannot do, and that no payment can move", () => {
    const text = flat("src/app/(app)/settings/page.tsx");
    expect(text).toContain("not available in this build");
    expect(text).toContain("cannot take a payment or charge a card");
  });

  test("the editor preview describes the blocks it actually draws", () => {
    expect(flat("src/app/(app)/projects/[id]/editor/editor-client.tsx")).toContain(
      "this build draws the timeline's timing blocks",
    );
  });

  test("the subtitle note points at the provider status, not a milestone", () => {
    for (const file of [
      "src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx",
      "src/app/api/studio/subtitles/route.ts",
    ]) {
      expect(flat(file)).toContain(
        "audio→subtitle transcription is a provider-backed step and reports its own provider status",
      );
    }
  });
});

/**
 * A phase number may survive only in a provenance comment. Anything in JSX text
 * or a string literal reaches a reader, and is an offender.
 */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) filesUnder(rel, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

/** The surfaces this pass corrected — the guard covers every one of them. */
const CORRECTED_SURFACES = [
  ...PUBLIC_SURFACES,
  "src/app/(app)/dashboard/page.tsx",
  "src/components/projects/project-list.tsx",
  "src/app/(app)/ai/script-writer/page.tsx",
  "src/components/script-writer/studio.tsx",
  "src/app/(app)/ai/audio-mix/page.tsx",
  "src/components/provider-not-connected.tsx",
  "src/components/ai-capability-status.tsx",
];

describe("no phase number reaches a reader on any corrected surface", () => {
  test("every Phase <n> in src/app and src/components is inside a comment", () => {
    const offenders: string[] = [];
    for (const file of CORRECTED_SURFACES) {
      const lines = source(file).split("\n");
      let inBlockComment = false;
      for (const line of lines) {
        const trimmed = line.trim();
        const isComment =
          inBlockComment ||
          ["//", "/*", "*", "{/*"].some((m) => trimmed.startsWith(m));
        if (trimmed.includes("/*") && !trimmed.includes("*/")) inBlockComment = true;
        else if (inBlockComment && trimmed.includes("*/")) inBlockComment = false;
        if (/Phase\s*\d/.test(line) && !isComment) {
          offenders.push(`${file}: ${trimmed.slice(0, 100)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
