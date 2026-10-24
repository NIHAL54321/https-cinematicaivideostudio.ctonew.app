/**
 * The AI tool pages' capability lists — ONE owner, with a standing that is
 * DERIVED per item instead of a heading typed over the whole list.
 *
 * WHAT WENT WRONG (block 0, 2026-10-24): every one of the ten `/ai/*` pages that
 * renders `AiToolPage` printed its feature list under one blanket heading,
 * "Planned capabilities". On nine of those ten pages some of the listed work is
 * already done by this build — the mix plan is computed (`src/lib/mix`), the
 * subtitle plan is built (`src/lib/subtitles`), the SEO titles, tags, chapters
 * and thumbnail concepts are derived from the project's own rows
 * (`src/lib/publishing`), the music and SFX catalogues and their selection
 * rules exist (`src/lib/music`, `src/lib/sfx`), the Brand Kit holds the
 * thumbnail preferences (`src/lib/brandkit`). A heading that says "planned" over
 * working features is the same contradiction the SEO Studio page told in
 * `288606a`, and the rendered sweep (`raw/rendered_sweep_3.txt`, group
 * `I_planned_heading`) found it on every one of them.
 *
 * HOW IT IS FIXED: an item no longer carries a hand-typed status word. Each
 * item declares WHERE ITS TRUTH COMES FROM:
 *
 *   - `derived`  — a module in this repo computes it, and the item names that
 *                  module plus a token that must be present in it. The sweep
 *                  test fails if the module is gone or the token is gone, so a
 *                  "works now" claim is anchored to code rather than to prose.
 *   - `provider` — the work needs an orchestrator capability. Whether that is
 *                  merely waiting for a key, available right now, or has no
 *                  adapter at all is read at RENDER time from
 *                  `capabilityConnectivity()` — the same derivation the status
 *                  API and every engine gate use. Nothing here decides it.
 *   - `unbuilt`  — no code path exists at all, and the item says why.
 *
 * The heading above each group comes from `CAPABILITY_STANDING_HEADING` — one
 * map, so the words on the page cannot drift from the derivation.
 *
 * The `/ai` pages are dynamic (`ƒ` in the build output), so the connectivity
 * read is per request and can never freeze a key's absence into a build.
 *
 * `./__tests__/ai-tool-description-sweep.test.ts` holds all of this: every page
 * has an entry, every item has a basis, every `derived` module and token exist,
 * the blanket heading is gone, and a negative control feeds the guard the exact
 * shipped heading to prove it still fails on it.
 */
import {
  capabilityConnectivity,
  type CapabilityConnectivity,
} from "@/lib/ai/providers/capability-connectivity";

/**
 * What is TRUE of one item today. Five states, and there is no sixth:
 *   - works-now     — this build computes it, no provider involved
 *   - available-now — needs a provider, and a wired one is configured here now
 *   - needs-key     — needs a provider, the adapter exists, its key is absent
 *   - no-adapter    — needs a provider and this build has no adapter for it
 *   - not-built     — no code path at all (not even a provider slot)
 */
export type CapabilityStanding =
  | "works-now"
  | "available-now"
  | "needs-key"
  | "no-adapter"
  | "not-built";

/** Where an item's truth comes from. Never a bare string. */
export type CapabilityBasis =
  /** Computed by this build. `rule` must appear in `module`. */
  | { kind: "derived"; module: string; rule: string }
  /** Needs an orchestrator capability (defaults to the page's own). */
  | { kind: "provider"; capability?: string }
  /** No code path exists; `why` names what is missing. */
  | { kind: "unbuilt"; why: string };

export interface AiCapabilityItem {
  text: string;
  basis: CapabilityBasis;
}

/** The heading over each group. Single-sourced so the page cannot drift. */
export const CAPABILITY_STANDING_HEADING: Record<CapabilityStanding, string> = {
  "works-now": "Works in this build now — no provider involved",
  "available-now": "Available now — a wired provider and its key are on this server",
  "needs-key": "Built and wired to a provider — waiting for that provider's key",
  "no-adapter": "Not built — no provider adapter exists for this capability yet",
  "not-built": "Not built in this build",
};

/** Render order: what works, then what is closest to working, then what is not. */
export const CAPABILITY_STANDING_ORDER: readonly CapabilityStanding[] = [
  "works-now",
  "available-now",
  "needs-key",
  "no-adapter",
  "not-built",
] as const;

/** The blanket heading the sweep found over working features. It may not return. */
export const REMOVED_BLANKET_HEADING = "Planned capabilities";

function derived(module: string, rule: string, text: string): AiCapabilityItem {
  return { text, basis: { kind: "derived", module, rule } };
}
function provider(text: string, capability?: string): AiCapabilityItem {
  return { text, basis: capability ? { kind: "provider", capability } : { kind: "provider" } };
}
function unbuilt(text: string, why: string): AiCapabilityItem {
  return { text, basis: { kind: "unbuilt", why } };
}

/**
 * One entry per page slug under `src/app/(app)/ai/`. `/ai/script-writer` has no
 * entry: it renders its own page and never showed the blanket heading (that is
 * why the rendered sweep found the heading on ten of the eleven `/ai` pages).
 */
export const AI_TOOL_CAPABILITIES: Record<string, readonly AiCapabilityItem[]> = {
  "audio-mix": [
    derived("src/lib/mix/engine.ts", "MixTrackId", "Exactly 4 tracks — voice, music, SFX, ambient"),
    derived(
      "src/app/(app)/ai/audio-mix/audio-mix-client.tsx",
      "Record<MixTrackId, number>",
      "Independent per-track volume (0-100%)",
    ),
    derived(
      "src/lib/mix/engine.ts",
      "PEAK_CEILING",
      "Deterministic clipping prevention via gain staging (≤ -1 dBFS)",
    ),
    derived(
      "src/lib/mix/engine.ts",
      "DEFAULT_LOUDNESS_TARGET_LUFS",
      "Loudness normalization toward a target (default -14 LUFS)",
    ),
    derived(
      "src/lib/music/ducking.ts",
      "buildDuckingSchedule",
      "Music ducking curve applied from the Music Studio schedule",
    ),
    derived(
      "src/lib/mix/engine.ts",
      "buildMix",
      "Mix PLAN only — this app has no audio renderer; the plan is what the mix engine produces",
    ),
  ],
  "image-generator": [
    provider("Aspect-ratio-correct images for every scene"),
    provider("Negative prompts & seed control"),
    provider("Batch generation for whole chapters"),
    provider("Automatic Brand Kit color grading"),
    provider("Saved to the Media Library with licensing metadata"),
  ],
  "music-studio": [
    derived(
      "src/lib/music/engine.ts",
      "MUSIC_CATEGORIES",
      "15 licensed categories — cinematic, emotional, technology, epic, ambient…",
    ),
    derived(
      "src/lib/music/engine.ts",
      "selectMusic",
      "Auto-selection by topic, emotion, scene type and pace",
    ),
    derived(
      "src/lib/music/engine.ts",
      "energyRange",
      "Mood / tempo / BPM / energy profile per category",
    ),
    derived(
      "src/lib/music/ducking.ts",
      "buildDuckingSchedule",
      "Automatic ducking under voiceover with manual volume control",
    ),
    provider("Licensing metadata recorded on every generated track"),
  ],
  "seo-studio": [
    derived(
      "src/lib/publishing/titles.ts",
      "buildTitlePlan",
      "Title & description variants from the project's own words",
    ),
    derived("src/lib/publishing/tags.ts", "buildTagPlan", "Tag and keyword suggestions"),
    derived("src/lib/publishing/chapters.ts", "buildChapters", "Chapter titles from scene structure"),
    derived("src/lib/publishing/thumbnails.ts", "buildThumbnailPlan", "Thumbnail text hooks"),
    derived("src/lib/projects.ts", "seoDefaults", "Defaults from ProjectSettings.seoDefaults"),
    // Wording note: "model-written" here would trip the rendered sweep's own
    // AI-attribution group, and a sweep hit that is really a statement of what
    // is NOT built is noise the next pass has to re-classify. This says the
    // same thing without the claim shape.
    provider("Titles, descriptions and tags from seo_generation — the one step that needs a provider"),
  ],
  "shorts-maker": [
    provider("Auto-extract the most engaging moments"),
    provider("Reframe 16:9 footage for vertical"),
    provider("Auto-captions with animated subtitles"),
    provider("Hook generation from the strongest line"),
    unbuilt(
      "Direct export to YouTube Shorts / TikTok",
      "no upload or platform-integration code path exists in this build",
    ),
  ],
  "sound-effects": [
    derived(
      "src/lib/sfx/engine.ts",
      "SFX_LIBRARY",
      "14 licensed effect types — whoosh, impact, ambience, UI accents…",
    ),
    derived(
      "src/lib/sfx/engine.ts",
      "selectSfxForScene",
      "Transition-matched whooshes and impacts — a transition effect fires only on its own transition type, never on a keyword",
    ),
    derived(
      "src/lib/sfx/engine.ts",
      "selectSfxForScene",
      "Ambience effects only on a keyword match; UI effects only on digital-topic scenes",
    ),
    derived(
      "src/lib/sfx/engine.ts",
      "placementPolicy",
      "Conservative placement: max 2 per scene, 1.5s minimum gap",
    ),
    provider("Licensing metadata recorded on every generated effect"),
  ],
  "subtitle-studio": [
    derived(
      "src/lib/subtitles/engine.ts",
      "buildSubtitles",
      "Word and sentence timing from the script or the Directed Voice Plan",
    ),
    derived(
      "src/lib/subtitles/engine.ts",
      "wrapLines",
      "Automatic line breaks at readable lengths (no mid-word splits)",
    ),
    derived(
      "src/lib/subtitles/engine.ts",
      "DEFAULT_SAFE_MARGINS",
      "Safe margins per format, mobile-friendly sizing",
    ),
    derived(
      "src/lib/subtitles/engine.ts",
      "chunkIntoPieces",
      "Dynamic captions — long cues split into short on-screen pieces",
    ),
    derived(
      "src/lib/subtitles/engine.ts",
      "SUBTITLE_KEYWORD_EMPHASIS",
      "Keyword emphasis flagged from the voice plan / pronunciation engine",
    ),
    derived(
      "src/lib/subtitles/styles.ts",
      "SUBTITLE_STYLES",
      "Auto style choice (Minimal, Cinematic, Modern, Creator, Bold…)",
    ),
    derived(
      "src/lib/subtitles/positioning.ts",
      "avoidRegions",
      "Placement computed against the face, text, chart or subject regions you supply — this build detects none of them itself",
    ),
    derived("src/lib/subtitles/engine.ts", "toSrt", "SRT export from the deterministic plan"),
  ],
  "thumbnail-generator": [
    provider("Generated from the script hook or key scene"),
    provider("Brand Kit colors, fonts and watermark applied"),
    derived(
      "src/lib/publishing/thumbnails.ts",
      "applyThumbnailControl",
      "Overlay wording per concept, and six controls that re-derive it",
    ),
    provider("Saved as an asset tied to the project"),
    derived(
      "src/lib/brandkit.ts",
      "thumbnailPreferences",
      "Thumbnail preferences live in the Brand Kit",
    ),
  ],
  "video-generator": [
    provider("Text-to-video per scene, resolution up to 4K"),
    provider("Seed control for consistent characters & scenes"),
    provider("Stock fallback with license & attribution tracking", "stock_media_search"),
    provider("Scene assets tagged by role (visual / B-roll / overlay)"),
    provider("Every generation recorded for audit & cost tracking"),
  ],
  "voice-studio": [
    provider("Scene-by-scene voiceover from narration text"),
    provider("Multi-language dubbing with 50+ provider languages"),
    provider("Voice, pitch, speed and pacing controls"),
    provider("Pronunciation corrections and lexicon"),
    derived(
      "src/lib/voice/director.ts",
      "directVoice",
      "Directed segment plan with timing estimates",
    ),
  ],
};

/** The page's own capability, for items that do not name one. */
export function standingOf(
  item: AiCapabilityItem,
  capability: string,
  connectivity?: CapabilityConnectivity,
): CapabilityStanding {
  if (item.basis.kind === "derived") return "works-now";
  if (item.basis.kind === "unbuilt") return "not-built";
  const cap = item.basis.capability ?? capability;
  const live = connectivity ?? capabilityConnectivity(cap);
  if (live.connected) return "available-now";
  if (live.wiredSlots.length > 0) return "needs-key";
  return "no-adapter";
}

export interface CapabilityGroup {
  standing: CapabilityStanding;
  heading: string;
  /** A derived sentence naming the wired adapter / env var NAMES. Never a value. */
  detail: string | null;
  items: readonly AiCapabilityItem[];
}

/**
 * Group a page's items by derived standing, in render order. Empty groups are
 * dropped — a page with nothing planned renders no "not built" heading at all.
 */
export function groupCapabilities(
  items: readonly AiCapabilityItem[],
  capability: string,
  connectivity?: CapabilityConnectivity,
): CapabilityGroup[] {
  const live = connectivity ?? capabilityConnectivity(capability);
  const byStanding = new Map<CapabilityStanding, AiCapabilityItem[]>();
  for (const item of items) {
    const s = standingOf(item, capability, live);
    const bucket = byStanding.get(s);
    if (bucket) bucket.push(item);
    else byStanding.set(s, [item]);
  }
  const groups: CapabilityGroup[] = [];
  for (const standing of CAPABILITY_STANDING_ORDER) {
    const bucket = byStanding.get(standing);
    if (!bucket || bucket.length === 0) continue;
    groups.push({
      standing,
      heading: CAPABILITY_STANDING_HEADING[standing],
      detail: providerDetail(standing, live),
      items: bucket,
    });
  }
  return groups;
}

/** The provider detail line: adapter names and env var NAMES only, never values. */
function providerDetail(
  standing: CapabilityStanding,
  live: CapabilityConnectivity,
): string | null {
  if (standing !== "needs-key" && standing !== "available-now") return null;
  const wired = live.wiredSlots;
  if (wired.length === 0) return null;
  const names = wired.map((s) => s.name).join(", ");
  const keys = Array.from(new Set(wired.flatMap((s) => s.envKeys))).sort();
  if (standing === "available-now") return `Serving now: ${names}.`;
  return `Adapter in this build: ${names}. Server-side env: ${keys.join(", ")}.`;
}
