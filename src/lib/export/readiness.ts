/**
 * Phase 6 Block 3 — PUBLISH-READINESS RULES (pure, client-safe).
 *
 * Six publish targets, each carrying the rules the app CAN check, each rule
 * quoting where it comes from. Every rule returns one of exactly three states:
 *
 *   pass     — the app checked it against real project data and it holds,
 *   fail     — the app checked it against real project data and it does not,
 *   unknown  — the app cannot verify it (no data, or it needs a provider).
 *
 * There is deliberately NO score and NO percentage anywhere in this module:
 * a rule that cannot be checked is reported as unknown with the reason, never
 * folded into a number that would read like a measurement.
 *
 * Rule sources, stated per rule in its `basis`:
 *   - duration limits          → the platform's published maximum length,
 *   - aspect ratio             → the Phase 5 framing engine's delivery formats
 *                                and the project's own declared target aspect,
 *   - export preset            → the Phase 6 Block 1 preset catalogue,
 *   - loudness                 → the Phase 4 final-mix engine's own target
 *                                (DEFAULT_LOUDNESS_TARGET_LUFS),
 *   - captions / thumbnail     → labelled APP POLICY where the platform publishes
 *                                no hard requirement, so nothing is presented as
 *                                a platform rule that is not one,
 *   - title / description/tags → the platform's published character limits,
 *   - policy / quality /             → PROVIDER-GATED: needs a media-analysis
 *     duplicate content                provider; always reported unknown.
 *
 * NOTHING IS WRITTEN by this module and nothing is uploaded.
 */
import { EXPORT_PRESET_IDS, findExportPreset, isExportPresetId, type ExportPresetId } from "./presets";
import { humanDuration } from "./sizing";
import { FRAME_FORMAT_SPECS, formatForAspectValue, sourceAspectSpec, type FrameFormatId } from "../framing/formats";
import { DEFAULT_LOUDNESS_TARGET_LUFS } from "../mix/engine";

/* ------------------------------------------------------------------ */
/* Gating                                                              */
/* ------------------------------------------------------------------ */

/** Capability a policy / quality / duplicate-content check needs. */
export const READINESS_MEDIA_ANALYSIS_CAPABILITY = "media_analysis";
/** Env var NAME (never a value) a server operator sets to connect it. */
export const READINESS_MEDIA_ANALYSIS_ENV = "MEDIA_ANALYSIS_API_KEY";
/** No provider is wired anywhere in this block. */
export const READINESS_MEDIA_ANALYSIS_CONNECTED = false;

export interface ReadinessGate {
  capability: string;
  connected: boolean;
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

/** The honest gate for every rule this app cannot check without a provider. */
export function readinessMediaAnalysisGate(what: string): ReadinessGate {
  return {
    capability: READINESS_MEDIA_ANALYSIS_CAPABILITY,
    connected: READINESS_MEDIA_ANALYSIS_CONNECTED,
    requiredEnv: [READINESS_MEDIA_ANALYSIS_ENV],
    envHint: READINESS_MEDIA_ANALYSIS_ENV,
    note:
      `${what} needs a connected media-analysis provider. ${READINESS_MEDIA_ANALYSIS_CAPABILITY} is not wired, so no frame, ` +
      "transcript or audio sample was analysed and nothing was compared against another video. This rule is reported UNKNOWN " +
      "rather than guessed: an operator enables it by setting the env var " +
      `${READINESS_MEDIA_ANALYSIS_ENV} (name only — never a value).`,
  };
}

/* ------------------------------------------------------------------ */
/* Targets                                                             */
/* ------------------------------------------------------------------ */

export const PUBLISH_TARGET_IDS = [
  "youtube-long-form",
  "youtube-shorts",
  "instagram-reels",
  "tiktok",
  "square",
  "portrait",
] as const;

export type PublishTargetId = (typeof PUBLISH_TARGET_IDS)[number];

export function isPublishTargetId(v: unknown): v is PublishTargetId {
  return typeof v === "string" && (PUBLISH_TARGET_IDS as readonly string[]).includes(v);
}

export function publishTargetCatalogueNote(): string {
  return "Expected one or more of: " + PUBLISH_TARGET_IDS.join(", ");
}

/** Per-target text limits, each with the platform's own basis. */
export interface TextLimits {
  /** null = the platform has no title field the app can verify. */
  titleMax: number | null;
  descriptionMax: number | null;
  /** Total characters allowed across all tags, or null when not verifiable. */
  tagsMaxChars: number | null;
  /** Tag / hashtag count cap, or null when the platform does not publish one. */
  tagsMaxCount: number | null;
  titleFieldLabel: string;
  descriptionFieldLabel: string;
  basis: string;
}

export interface PublishTargetSpec {
  id: PublishTargetId;
  label: string;
  platform: string;
  formatId: FrameFormatId;
  aspect: string;
  resolution: string;
  /** Any one of these applied presets delivers this target honestly. */
  requiredPresetIds: ExportPresetId[];
  preferredPresetId: ExportPresetId;
  duration: { maxSeconds: number; appCeilingSeconds: number; basis: string };
  text: TextLimits;
  captions: { severity: RuleSeverity; basis: string };
  thumbnail: { severity: RuleSeverity; basis: string };
  loudness: { targetLufs: number; toleranceLu: number; basis: string };
  notes: string[];
}

const YOUTUBE_TEXT: TextLimits = {
  titleMax: 100,
  descriptionMax: 5000,
  tagsMaxChars: 500,
  tagsMaxCount: null,
  titleFieldLabel: "Title",
  descriptionFieldLabel: "Description",
  basis:
    "YouTube's published limits: a title of up to 100 characters, a description of up to 5000 characters and up to 500 " +
    "characters in total across the tags field. YouTube publishes no separate tag COUNT limit the app can verify, so this " +
    "check compares characters only.",
};

const INSTAGRAM_TEXT: TextLimits = {
  titleMax: null,
  descriptionMax: 2200,
  tagsMaxChars: null,
  tagsMaxCount: 30,
  titleFieldLabel: "Title (not a field on this surface)",
  descriptionFieldLabel: "Caption",
  basis:
    "Instagram's published caption limit: 2200 characters, with up to 30 hashtags per post. A Reels or feed post has ONE " +
    "caption field — there is no separate title field — so no title length can be checked here and that rule is reported as " +
    "not verifiable instead of being invented.",
};

const TIKTOK_TEXT: TextLimits = {
  titleMax: 2200,
  descriptionMax: 2200,
  tagsMaxChars: null,
  tagsMaxCount: null,
  titleFieldLabel: "Caption (TikTok's single text field)",
  descriptionFieldLabel: "Caption",
  basis:
    "TikTok's published caption limit: 2200 characters. TikTok has one caption field, so the project's title and description " +
    "both travel in the same field; hashtags are part of that caption and TikTok publishes no separate tag count the app can " +
    "verify, so no tag count is checked.",
};

const YOUTUBE_LOUDNESS_BASIS =
  "YouTube normalizes playback to about -14 LUFS integrated. The value compared here is the final-mix engine's own target " +
  `(DEFAULT_LOUDNESS_TARGET_LUFS = ${DEFAULT_LOUDNESS_TARGET_LUFS} LUFS in src/lib/mix/engine.ts), and the mix's loudness is ` +
  "the engine's own ESTIMATE for this timeline — not a measurement of rendered audio.";

const SOCIAL_LOUDNESS_BASIS =
  "Instagram and TikTok normalize playback on their side and do not publish a fixed delivery target the app can verify. The " +
  `value compared here is the app's own final-mix target (DEFAULT_LOUDNESS_TARGET_LUFS = ${DEFAULT_LOUDNESS_TARGET_LUFS} LUFS ` +
  "in src/lib/mix/engine.ts) — a stated app target, not a platform rule — and the mix's loudness is the engine's ESTIMATE.";

const CAPTIONS_APP_POLICY =
  "APP POLICY (stated, not a platform rule): this target delivers with captions, because the subtitle engine's cue file is " +
  "part of the finishing set and a muted feed loses the narration entirely. The platform publishes no captions requirement " +
  "the app can check, so this is the app's own rule and is labelled as such.";

const CAPTIONS_RECOMMENDED =
  "APP POLICY (stated, not a platform rule): captions are recommended for this target — they are an accessibility feature " +
  "and the subtitle engine already produces the cue data. The platform does not require them, so this rule is not blocking.";

const THUMBNAIL_BASIS =
  "APP POLICY (stated, not a platform rule): a chosen thumbnail is recommended for every target; if none is selected the " +
  "platform picks a frame from the video itself. No image is ever fabricated here — an absent thumbnail is reported absent.";

export const PUBLISH_TARGETS: readonly PublishTargetSpec[] = [
  {
    id: "youtube-long-form",
    label: "YouTube long-form",
    platform: "YouTube",
    formatId: "16:9",
    aspect: "16:9",
    resolution: FRAME_FORMAT_SPECS["16:9"].widthPx + "×" + FRAME_FORMAT_SPECS["16:9"].heightPx,
    requiredPresetIds: ["youtube-1080p", "youtube-2160p", "youtube-2160p-hdr"],
    preferredPresetId: "youtube-1080p",
    duration: {
      maxSeconds: 43_200,
      appCeilingSeconds: 7_200,
      basis:
        "YouTube's published maximum upload length is 12 hours (43,200 s) for a verified account and 15 minutes for an " +
        "unverified one; this app cannot verify an account's status and plans long-form at no more than 120 minutes " +
        "(7,200 s) by its own stated ceiling, so the platform limit is the rule compared here.",
    },
    text: YOUTUBE_TEXT,
    captions: { severity: "recommended", basis: CAPTIONS_RECOMMENDED },
    thumbnail: { severity: "recommended", basis: THUMBNAIL_BASIS },
    loudness: { targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, toleranceLu: 1, basis: YOUTUBE_LOUDNESS_BASIS },
    notes: [
      "Long-form 16:9 delivery; the 1080p preset matches a 1080p source exactly and the 4K presets need a real upscale.",
      "The HDR preset is only valid for footage graded with an HDR target — the colour system reports when PQ tone-mapping would be needed.",
    ],
  },
  {
    id: "youtube-shorts",
    label: "YouTube Shorts",
    platform: "YouTube Shorts",
    formatId: "9:16",
    aspect: "9:16",
    resolution: FRAME_FORMAT_SPECS["9:16"].widthPx + "×" + FRAME_FORMAT_SPECS["9:16"].heightPx,
    requiredPresetIds: ["youtube-shorts"],
    preferredPresetId: "youtube-shorts",
    duration: {
      maxSeconds: 180,
      appCeilingSeconds: 7_200,
      basis:
        "YouTube's published Shorts limit is 3 minutes (180 s); a vertical upload longer than that is served as a regular " +
        "video rather than as a Short.",
    },
    text: YOUTUBE_TEXT,
    captions: { severity: "required", basis: CAPTIONS_APP_POLICY },
    thumbnail: { severity: "recommended", basis: THUMBNAIL_BASIS },
    loudness: { targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, toleranceLu: 1, basis: YOUTUBE_LOUDNESS_BASIS },
    notes: [
      "Vertical 9:16. From a 16:9 master the kept columns are upscaled — the framing plan reports the factor per clip.",
      "Shorts sharing YouTube's long-form title/description limits is a real consequence of it being the same upload surface.",
    ],
  },
  {
    id: "instagram-reels",
    label: "Instagram Reels",
    platform: "Instagram",
    formatId: "9:16",
    aspect: "9:16",
    resolution: FRAME_FORMAT_SPECS["9:16"].widthPx + "×" + FRAME_FORMAT_SPECS["9:16"].heightPx,
    requiredPresetIds: ["instagram-reels"],
    preferredPresetId: "instagram-reels",
    duration: {
      maxSeconds: 180,
      appCeilingSeconds: 7_200,
      basis: "Instagram's published Reels limit is 3 minutes (180 s).",
    },
    text: INSTAGRAM_TEXT,
    captions: { severity: "required", basis: CAPTIONS_APP_POLICY },
    thumbnail: { severity: "recommended", basis: THUMBNAIL_BASIS },
    loudness: { targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, toleranceLu: 1, basis: SOCIAL_LOUDNESS_BASIS },
    notes: ["Reels' own caption layer is authored in the app; the container track is declared by the preset and nothing is muxed."],
  },
  {
    id: "tiktok",
    label: "TikTok",
    platform: "TikTok",
    formatId: "9:16",
    aspect: "9:16",
    resolution: FRAME_FORMAT_SPECS["9:16"].widthPx + "×" + FRAME_FORMAT_SPECS["9:16"].heightPx,
    requiredPresetIds: ["tiktok"],
    preferredPresetId: "tiktok",
    duration: {
      maxSeconds: 600,
      appCeilingSeconds: 7_200,
      basis: "TikTok's published standard upload limit is 10 minutes (600 s).",
    },
    text: TIKTOK_TEXT,
    captions: { severity: "required", basis: CAPTIONS_APP_POLICY },
    thumbnail: { severity: "recommended", basis: THUMBNAIL_BASIS },
    loudness: { targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, toleranceLu: 1, basis: SOCIAL_LOUDNESS_BASIS },
    notes: ["Identical geometry to Shorts and Reels; TikTok's own overlay UI is why the framing engine's caption-safe band matters."],
  },
  {
    id: "square",
    label: "Square 1:1 feed post",
    platform: "Instagram / LinkedIn / X feed",
    formatId: "1:1",
    aspect: "1:1",
    resolution: FRAME_FORMAT_SPECS["1:1"].widthPx + "×" + FRAME_FORMAT_SPECS["1:1"].heightPx,
    requiredPresetIds: ["square-1080"],
    preferredPresetId: "square-1080",
    duration: {
      maxSeconds: 3_600,
      appCeilingSeconds: 7_200,
      basis:
        "Instagram's published feed video limit is 60 minutes (3,600 s). The app cannot verify which surface a square export " +
        "is posted to, so this is the limit of the feed surface the preset's own platform field names.",
    },
    text: INSTAGRAM_TEXT,
    captions: { severity: "recommended", basis: CAPTIONS_RECOMMENDED },
    thumbnail: { severity: "recommended", basis: THUMBNAIL_BASIS },
    loudness: { targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, toleranceLu: 1, basis: SOCIAL_LOUDNESS_BASIS },
    notes: ["1080×1080 is the least destructive narrow crop of a 16:9 master — full height, 56% of the width at 1080p."],
  },
  {
    id: "portrait",
    label: "Portrait 4:5 feed post",
    platform: "Instagram / Facebook feed",
    formatId: "4:5",
    aspect: "4:5",
    resolution: FRAME_FORMAT_SPECS["4:5"].widthPx + "×" + FRAME_FORMAT_SPECS["4:5"].heightPx,
    requiredPresetIds: ["portrait-4x5"],
    preferredPresetId: "portrait-4x5",
    duration: {
      maxSeconds: 3_600,
      appCeilingSeconds: 7_200,
      basis:
        "Instagram's published feed video limit is 60 minutes (3,600 s). The app cannot verify which surface a portrait " +
        "export is posted to, so this is the limit of the feed surface the preset's own platform field names.",
    },
    text: INSTAGRAM_TEXT,
    captions: { severity: "recommended", basis: CAPTIONS_RECOMMENDED },
    thumbnail: { severity: "recommended", basis: THUMBNAIL_BASIS },
    loudness: { targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, toleranceLu: 1, basis: SOCIAL_LOUDNESS_BASIS },
    notes: ["1080×1350 — taller than square, shorter than 9:16, and the feed portrait Instagram actually renders."],
  },
];

const TARGET_INDEX = new Map<PublishTargetId, PublishTargetSpec>(PUBLISH_TARGETS.map((t) => [t.id, t]));

export function findPublishTarget(id: unknown): PublishTargetSpec | null {
  if (!isPublishTargetId(id)) return null;
  return TARGET_INDEX.get(id) ?? null;
}

/** Targets in canonical order (the order they are always reported in). */
export function orderPublishTargetIds(ids: unknown): PublishTargetId[] {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((v): v is PublishTargetId => isPublishTargetId(v)));
  return PUBLISH_TARGET_IDS.filter((id) => wanted.has(id));
}

export function unknownPublishTargetIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => !isPublishTargetId(id)).map((id) => (typeof id === "string" ? id : JSON.stringify(id)));
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export type RuleStatus = "pass" | "fail" | "unknown";
export type RuleSeverity = "required" | "recommended";

export interface RuleResult {
  id: string;
  label: string;
  /** The rule, in one sentence a reader can check. */
  rule: string;
  /** Where the rule comes from. */
  basis: string;
  severity: RuleSeverity;
  status: RuleStatus;
  /** The project's ACTUAL value for this rule, as text. */
  actual: string;
  detail: string;
  /** Present only on a rule that is unknown because it needs a provider. */
  gate?: ReadinessGate;
}

function rule(r: RuleResult): RuleResult {
  return r;
}

/** Everything the readiness check needs, all of it already computed from project data. */
export interface ReadinessInput {
  durationSeconds: number;
  durationSource: string;
  /** The Prisma `AspectRatio` enum value the project declares, or null. */
  targetAspect: string | null;
  appliedPresetIds: readonly ExportPresetId[];
  cueCount: number;
  captionSource: string;
  /** The final-mix engine's ESTIMATE for this project, or null when there is no mix. */
  mix: { estimateLufs: number; targetLufs: number; hasAudioClips: boolean; model: string } | null;
  thumbnail: { present: boolean; assetName: string | null; detail: string };
  metadata: {
    title: string | null;
    description: string | null;
    tags: string[] | null;
    titleSource: string;
    descriptionSource: string;
    tagsSource: string;
  };
}

/** Numeric comparison, reported to the same precision in every message. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function durationRule(spec: PublishTargetSpec, input: ReadinessInput): RuleResult {
  const max = spec.duration.maxSeconds;
  return rule({
    id: "duration_within_limit",
    label: "Duration within the platform limit",
    rule: `The finished video must be no longer than ${humanDuration(max)} (${max} s).`,
    basis: spec.duration.basis,
    severity: "required",
    status: input.durationSeconds <= 0 ? "unknown" : input.durationSeconds <= max ? "pass" : "fail",
    actual:
      input.durationSeconds > 0
        ? `${humanDuration(input.durationSeconds)} (${round2(input.durationSeconds)} s, from ${input.durationSource})`
        : "no duration available",
    detail:
      input.durationSeconds <= 0
        ? "No duration is available — nothing was supplied, no timeline is saved and no scene carries a duration — so the limit cannot be checked."
        : input.durationSeconds <= max
          ? `Inside the limit by ${humanDuration(max - input.durationSeconds)}.`
          : `Over the limit by ${humanDuration(input.durationSeconds - max)}. The app's own long-form ceiling (${humanDuration(
              spec.duration.appCeilingSeconds,
            )}) does not override the platform's.`,
  });
}

function aspectRule(spec: PublishTargetSpec, input: ReadinessInput): RuleResult {
  const wanted = FRAME_FORMAT_SPECS[spec.formatId];
  const source = sourceAspectSpec(input.targetAspect);
  if (!source) {
    return rule({
      id: "aspect_ratio_match",
      label: "Aspect ratio matches the target",
      rule: `The project's declared target aspect must be ${spec.aspect}.`,
      basis:
        "The project's own `targetAspectRatio` field, mapped through the Phase 5 framing engine's delivery formats " +
        "(FRAME_FORMAT_SPECS in src/lib/framing/formats.ts).",
      severity: "required",
      status: "unknown",
      actual: input.targetAspect ? `unrecognised value "${input.targetAspect}"` : "no target aspect declared",
      detail:
        "The project has not declared a target aspect ratio, so there is nothing to compare against this target's " +
        `${spec.aspect}. Nothing was assumed on the project's behalf.`,
    });
  }
  const mapped = formatForAspectValue(source.aspectValue);
  const matches = mapped.id === spec.formatId;
  return rule({
    id: "aspect_ratio_match",
    label: "Aspect ratio matches the target",
    rule: `The project's declared target aspect must be ${spec.aspect}.`,
    basis:
      "The project's own `targetAspectRatio` field, mapped through the Phase 5 framing engine's delivery formats " +
      "(FRAME_FORMAT_SPECS, formatForAspectValue in src/lib/framing/formats.ts).",
    severity: "required",
    status: matches ? "pass" : "fail",
    actual: `${source.label} declared (${source.enumValue}) → ${FRAME_FORMAT_SPECS[mapped.id].label} ${mapped.note}`,
    detail: matches
      ? `Matches the target's ${spec.aspect} (${wanted.widthPx}×${wanted.heightPx}).`
      : `The project declares ${source.label}, which is a ${spec.aspect} delivery mismatch — the framing engine would have to reframe every clip.`,
  });
}

function presetRule(spec: PublishTargetSpec, input: ReadinessInput): RuleResult {
  const applied = [...input.appliedPresetIds].filter((id) => isExportPresetId(id));
  const required = spec.requiredPresetIds
    .map((id) => findExportPreset(id))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const requiredNames = required.map((p) => `${p.label} (${p.id})`).join(", ");
  const matched = applied.find((id) => spec.requiredPresetIds.includes(id));
  if (applied.length === 0) {
    return rule({
      id: "export_preset_applied",
      label: "Required export preset applied",
      rule: `One of these delivery presets must be applied to the project: ${requiredNames}.`,
      basis: "The Phase 6 Block 1 preset catalogue (EXPORT_PRESET_IDS in src/lib/export/presets.ts) and the project's stored preset choice (ProjectSettings.extra.exportPreset).",
      severity: "required",
      status: "unknown",
      actual: "no delivery preset is applied",
      detail:
        "No preset is applied, so what this project would deliver is undecided — the check cannot say whether it would deliver " +
        "this target's specification.",
    });
  }
  return rule({
    id: "export_preset_applied",
    label: "Required export preset applied",
    rule: `One of these delivery presets must be applied to the project: ${requiredNames}.`,
    basis: "The Phase 6 Block 1 preset catalogue (EXPORT_PRESET_IDS in src/lib/export/presets.ts) and the project's stored preset choice (ProjectSettings.extra.exportPreset).",
    severity: "required",
    status: matched ? "pass" : "fail",
    actual: `applied: ${applied.join(", ")}`,
    detail: matched
      ? `${matched} delivers this target.`
      : `None of the applied presets delivers this target — the export would not match it without re-exporting.`,
  });
}

function loudnessRule(spec: PublishTargetSpec, input: ReadinessInput): RuleResult {
  const base = {
    id: "loudness_target_met",
    label: "Final mix meets the loudness target",
    rule: `The final mix's integrated loudness must sit within ±${spec.loudness.toleranceLu} LU of ${spec.loudness.targetLufs} LUFS.`,
    basis: spec.loudness.basis,
    severity: "required" as RuleSeverity,
  };
  if (!input.mix || !input.mix.hasAudioClips) {
    return rule({
      ...base,
      status: "unknown",
      actual: "no mix — the timeline carries no voice, music or SFX clips",
      detail:
        "There is no audio on the timeline to judge, so the loudness rule cannot be checked. Nothing was assumed about the mix.",
    });
  }
  const delta = Math.abs(input.mix.estimateLufs - spec.loudness.targetLufs);
  const inside = delta <= spec.loudness.toleranceLu;
  return rule({
    ...base,
    status: inside ? "pass" : "fail",
    actual: `~${round2(input.mix.estimateLufs)} LUFS estimated (mix target ${input.mix.targetLufs} LUFS, ${round2(delta)} LU from this target)`,
    detail:
      (inside
        ? `Inside the ±${spec.loudness.toleranceLu} LU window. `
        : `Outside the ±${spec.loudness.toleranceLu} LU window — the renderer's normalization would have to correct it, which is provider work. `) +
      input.mix.model,
  });
}

function captionsRule(spec: PublishTargetSpec, input: ReadinessInput): RuleResult {
  return rule({
    id: "captions_present",
    label: "Captions present",
    rule: `The project must have subtitle cues to deliver captions with this target.`,
    basis: spec.captions.basis,
    severity: spec.captions.severity,
    status: input.cueCount > 0 ? "pass" : "fail",
    actual: `${input.cueCount} cue(s) — ${input.captionSource}`,
    detail:
      input.cueCount > 0
        ? "The subtitle engine produced cues for this project's narrated scenes."
        : "No cues exist: this project has no scene narration on its timeline, so nothing could be captioned. Zero is a real answer here, not a failure of the check.",
  });
}

function thumbnailRule(spec: PublishTargetSpec, input: ReadinessInput): RuleResult {
  return rule({
    id: "thumbnail_present",
    label: "Thumbnail selected",
    rule: "A chosen thumbnail image must exist for the project.",
    basis: spec.thumbnail.basis,
    severity: spec.thumbnail.severity,
    status: input.thumbnail.present ? "pass" : "fail",
    actual: input.thumbnail.present
      ? `${input.thumbnail.assetName ?? "thumbnail asset"} (${input.thumbnail.detail})`
      : "none selected",
    detail: input.thumbnail.present
      ? "The project holds a thumbnail asset; no image was generated or modified by this check."
      : "No thumbnail asset exists for this project. Nothing was fabricated to fill the slot — the platform would pick a frame instead.",
  });
}

function titleRules(spec: PublishTargetSpec, input: ReadinessInput): RuleResult[] {
  const title = input.metadata.title;
  if (spec.text.titleMax === null) {
    return [
      rule({
        id: "title_within_limit",
        label: "Title within the platform limit",
        rule: "The title must be within the platform's published title limit.",
        basis: spec.text.basis,
        severity: "recommended",
        status: "unknown",
        actual: "not verifiable on this surface",
        detail: `${spec.platform} has no title field this app can verify (${spec.text.titleFieldLabel}), so no length can be compared.`,
      }),
    ];
  }
  const max = spec.text.titleMax;
  return [
    rule({
      id: "title_present",
      label: "Title present",
      rule: "The project must carry a non-empty title.",
      basis: `The platform's published ${spec.text.titleFieldLabel.toLowerCase()} limit (${max} characters) and the project's own title field.`,
      severity: "required",
      status: title && title.trim() ? "pass" : "fail",
      actual: title && title.trim() ? `${title.trim().length} character(s) — "${title.trim()}"` : "no title",
      detail:
        title && title.trim()
          ? `From ${input.metadata.titleSource}.`
          : "The project has no title text. Nothing was generated to fill it.",
    }),
    rule({
      id: "title_within_limit",
      label: "Title within the platform limit",
      rule: `${spec.text.titleFieldLabel} must be at most ${max} characters.`,
      basis: spec.text.basis,
      severity: "required",
      status: !title || !title.trim() ? "unknown" : title.trim().length <= max ? "pass" : "fail",
      actual: title && title.trim() ? `${title.trim().length} / ${max} characters` : "no title text exists, so no length can be compared",
      detail:
        !title || !title.trim()
          ? "There is no title text, so the limit cannot be evaluated."
          : title.trim().length <= max
            ? `${max - title.trim().length} character(s) of headroom.`
            : `Over by ${title.trim().length - max} character(s) — the platform truncates.`,
    }),
  ];
}

function descriptionRules(spec: PublishTargetSpec, input: ReadinessInput): RuleResult[] {
  const description = input.metadata.description;
  const max = spec.text.descriptionMax;
  if (max === null) {
    return [
      rule({
        id: "description_within_limit",
        label: "Description within the platform limit",
        rule: "The description must be within the platform's published limit.",
        basis: spec.text.basis,
        severity: "recommended",
        status: "unknown",
        actual: "not verifiable",
        detail: `${spec.platform} publishes no description limit this app can verify.`,
      }),
    ];
  }
  return [
    rule({
      id: "description_present",
      label: "Description present",
      rule: `The project should carry a ${spec.text.descriptionFieldLabel.toLowerCase()}.`,
      basis: spec.text.basis,
      severity: "recommended",
      status: description && description.trim() ? "pass" : "fail",
      actual: description && description.trim() ? `${description.trim().length} character(s)` : "no description",
      detail:
        description && description.trim()
          ? `From ${input.metadata.descriptionSource}.`
          : "The project has no description text. Nothing was generated to fill it.",
    }),
    rule({
      id: "description_within_limit",
      label: "Description within the platform limit",
      rule: `${spec.text.descriptionFieldLabel} must be at most ${max} characters.`,
      basis: spec.text.basis,
      severity: "required",
      status: !description || !description.trim() ? "unknown" : description.trim().length <= max ? "pass" : "fail",
      actual:
        description && description.trim()
          ? `${description.trim().length} / ${max} characters`
          : "no description text exists, so no length can be compared",
      detail:
        !description || !description.trim()
          ? "There is no description text, so the limit cannot be evaluated."
          : description.trim().length <= max
            ? `${max - description.trim().length} character(s) of headroom.`
            : `Over by ${description.trim().length - max} character(s).`,
    }),
  ];
}

function tagRules(spec: PublishTargetSpec, input: ReadinessInput): RuleResult[] {
  const tags = input.metadata.tags;
  const totalChars = tags ? tags.reduce((sum, t) => sum + t.length, 0) : null;
  const out: RuleResult[] = [
    rule({
      id: "tags_present",
      label: "Tags present",
      rule: "The project should carry tags (or hashtags) for this surface.",
      basis: spec.text.basis,
      severity: "recommended",
      status: tags && tags.length > 0 ? "pass" : "fail",
      actual: tags && tags.length > 0 ? `${tags.length} tag(s), ${totalChars} character(s) total` : "no tags",
      detail:
        tags && tags.length > 0
          ? `From ${input.metadata.tagsSource}.`
          : "The project stores no tags. Nothing was invented to fill them.",
    }),
  ];

  const maxChars = spec.text.tagsMaxChars;
  const maxCount = spec.text.tagsMaxCount;
  if (maxChars === null && maxCount === null) {
    out.push(
      rule({
        id: "tags_within_limit",
        label: "Tags within the platform limit",
        rule: "The tag set must be within the platform's published limits.",
        basis: spec.text.basis,
        severity: "recommended",
        status: "unknown",
        actual: "not verifiable",
        detail: `${spec.platform} publishes no tag length or tag count limit this app can verify.`,
      }),
    );
    return out;
  }
  const overChars = maxChars !== null && totalChars !== null && totalChars > maxChars;
  const overCount = maxCount !== null && tags !== null && tags.length > maxCount;
  out.push(
    rule({
      id: "tags_within_limit",
      label: "Tags within the platform limit",
      rule:
        maxChars !== null && maxCount !== null
          ? `Tags must total at most ${maxChars} characters and number at most ${maxCount}.`
          : maxChars !== null
            ? `Tags must total at most ${maxChars} characters.`
            : `There must be at most ${maxCount} tags.`,
      basis: spec.text.basis,
      severity: "required",
      status: tags === null ? "unknown" : overChars || overCount ? "fail" : "pass",
      actual:
        tags === null
          ? "no tags exist, so no limit can be compared"
          : `${totalChars ?? 0} / ${maxChars ?? "n/a"} characters · ${tags.length} / ${maxCount ?? "n/a"} tags`,
      detail:
        tags === null
          ? "There are no tags, so the limits cannot be evaluated."
          : overChars || overCount
            ? "Over the platform's published limit — the platform truncates."
            : "Inside the platform's published limit.",
    }),
  );
  return out;
}

function policyRule(): RuleResult {
  const gate = readinessMediaAnalysisGate("Checking platform policy, content quality and duplicate content");
  return rule({
    id: "policy_and_quality",
    label: "Platform policy, quality and duplicate-content check",
    rule: "The video must not breach platform policy, must clear the platform's quality bar and must not duplicate existing content.",
    basis:
      "No deterministic check exists for this in the app: each part needs a real content analysis (frames, transcript, audio) " +
      "and the platform's own enforcement is not queryable. It is reported as an honest gate, never estimated.",
    severity: "recommended",
    status: "unknown",
    actual: "not checkable without a provider",
    detail: gate.note,
    gate,
  });
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export type ReadinessVerdict = "ready" | "ready_with_warnings" | "not_ready" | "indeterminate";

export interface TargetReport {
  targetId: PublishTargetId;
  label: string;
  platform: string;
  aspect: string;
  resolution: string;
  requiredPresetIds: ExportPresetId[];
  rules: RuleResult[];
  counts: { pass: number; fail: number; unknown: number; total: number };
  /** Required rules whose status is "fail" — these block. */
  blockingFailures: string[];
  /** Required rules whose status is "unknown" — these stop a positive verdict. */
  unknownRequired: string[];
  /** Recommended rules that failed — warnings, not blockers. */
  warnings: string[];
  verdict: ReadinessVerdict;
  notes: string[];
}

/**
 * The verdict, in the order the app can justify it:
 *   not_ready      → a required rule FAILED,
 *   indeterminate  → a required rule is UNKNOWN,
 *   ready_with_warnings → only recommended rules failed,
 *   ready          → every required rule passed and no recommendation failed.
 * No percentage, no score, no estimate is ever derived from these counts.
 */
export function readinessVerdict(rules: readonly RuleResult[]): {
  verdict: ReadinessVerdict;
  blockingFailures: string[];
  unknownRequired: string[];
  warnings: string[];
} {
  const blockingFailures = rules.filter((r) => r.severity === "required" && r.status === "fail").map((r) => r.id);
  const unknownRequired = rules.filter((r) => r.severity === "required" && r.status === "unknown").map((r) => r.id);
  const warnings = rules.filter((r) => r.severity === "recommended" && r.status === "fail").map((r) => r.id);
  const verdict: ReadinessVerdict =
    blockingFailures.length > 0
      ? "not_ready"
      : unknownRequired.length > 0
        ? "indeterminate"
        : warnings.length > 0
          ? "ready_with_warnings"
          : "ready";
  return { verdict, blockingFailures, unknownRequired, warnings };
}

/** Check one target. Pure: the same input always yields the same report. */
export function checkTargetReadiness(spec: PublishTargetSpec, input: ReadinessInput): TargetReport {
  const rules: RuleResult[] = [
    durationRule(spec, input),
    aspectRule(spec, input),
    presetRule(spec, input),
    loudnessRule(spec, input),
    captionsRule(spec, input),
    thumbnailRule(spec, input),
    ...titleRules(spec, input),
    ...descriptionRules(spec, input),
    ...tagRules(spec, input),
    policyRule(),
  ];
  const { verdict, blockingFailures, unknownRequired, warnings } = readinessVerdict(rules);
  return {
    targetId: spec.id,
    label: spec.label,
    platform: spec.platform,
    aspect: spec.aspect,
    resolution: spec.resolution,
    requiredPresetIds: [...spec.requiredPresetIds],
    rules,
    counts: {
      pass: rules.filter((r) => r.status === "pass").length,
      fail: rules.filter((r) => r.status === "fail").length,
      unknown: rules.filter((r) => r.status === "unknown").length,
      total: rules.length,
    },
    blockingFailures,
    unknownRequired,
    warnings,
    verdict,
    notes: [...spec.notes],
  };
}

/** One target report per requested target, in canonical order. */
export function checkPublishReadiness(
  targetIds: readonly PublishTargetId[],
  input: ReadinessInput,
): TargetReport[] {
  return orderPublishTargetIds([...targetIds])
    .map((id) => findPublishTarget(id))
    .filter((t): t is PublishTargetSpec => t !== null)
    .map((spec) => checkTargetReadiness(spec, input));
}

/** The preset catalogue, as a readiness note (used by typed error bodies). */
export function requiredPresetNote(): string {
  return "Presets in the catalogue: " + EXPORT_PRESET_IDS.join(", ");
}

/** The rule catalogue a target reports, for the typed-error note. */
export function ruleIdsForTargetId(id: unknown): string[] {
  const spec = findPublishTarget(id);
  if (!spec) return [];
  return checkTargetReadiness(spec, EMPTY_READINESS_INPUT).rules.map((r) => r.id);
}

/**
 * An all-unknown input: used only to enumerate the rule ids a target reports.
 * Every value is explicitly "nothing known", never a plausible-looking default.
 */
export const EMPTY_READINESS_INPUT: ReadinessInput = {
  durationSeconds: 0,
  durationSource: "none",
  targetAspect: null,
  appliedPresetIds: [],
  cueCount: 0,
  captionSource: "no cue source",
  mix: null,
  thumbnail: { present: false, assetName: null, detail: "no thumbnail asset" },
  metadata: { title: null, description: null, tags: null, titleSource: "none", descriptionSource: "none", tagsSource: "none" },
};
