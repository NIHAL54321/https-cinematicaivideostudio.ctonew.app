/**
 * Phase 5 Block 5b — FRAMING POLICIES (pure, deterministic, no IO).
 *
 * A framing policy is a STATED RULE that decides where the crop window sits
 * inside the source frame, plus a stated rule for whether the window moves over
 * the clip. Policies exist because the app cannot know where a face, chart or
 * line of text actually is — see `anchorCheck()` at the bottom of this file,
 * which enumerates every field in the data model that might have held a subject
 * position and reports what each of them really holds.
 *
 * The four policies:
 *
 *   centre-cover        hold the window on the source centre. Deterministic
 *                       fallback; claims nothing about the content.
 *   upper-third-bias    hold the window with its vertical anchor one third down
 *                       the source — the classic headroom bias for a
 *                       person-shaped frame. Selected by data (vertical travel
 *                       exists AND the scene is narration-bearing), and the
 *                       reason says in plain words that this is a rule about a
 *                       person-shaped frame, NOT a measurement of where anyone is.
 *   caption-safe-hold   slide the window along the cropping axis so the subtitle
 *                       engine's caption band (its own SUBTITLE_SAFE_MARGINS /
 *                       line-height constants, scaled) is NOT cut out of frame,
 *                       when the crop would otherwise cut it.
 *   pan-across-travel   pan the window linearly across the travel it has, from
 *                       lowest to highest, over the clip's duration. Explicit
 *                       choice only: it is a stated rule, not subject tracking.
 *
 * On top of whichever policy is chosen, ONE invariant is always enforced and
 * always reported with real numbers: the window is kept inside the source's
 * ACTION-SAFE rect on every axis where it fits (`safeAreaClamp`). That is the
 * "keep a wide clip's action inside the safe area" rule — it is measured, not
 * asserted.
 *
 * Every decision carries: the policy, why it was selected (citing the data), the
 * numeric signals behind that reason, the alternatives that were considered, the
 * final crop, and the caption check.
 */
import { ACTION_SAFE_FRACTION, type Rect } from "./formats";
import {
  bestWindowFor,
  clampInside,
  coverCrop,
  cropsEqual,
  intersectRect,
  mapSourceRectToTarget,
  retainedAreaRatio,
  type AnchorPoint,
  type CropResult,
  type SourceFrame,
  type TargetFrame,
} from "./geometry";

/* ------------------------------------------------------------------ */
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

export const FRAMING_POLICIES = ["centre-cover", "upper-third-bias", "caption-safe-hold", "pan-across-travel"] as const;
export type FramingPolicyId = (typeof FRAMING_POLICIES)[number];

export interface FramingPolicy {
  id: FramingPolicyId;
  label: string;
  /** The rule, in plain language, exactly as it is executed. */
  rule: string;
  /** Vertical / horizontal anchor in source coordinates. */
  anchor: AnchorPoint;
  motion: "hold" | "pan";
  /** true = never auto-selected; the caller must ask for it. */
  explicitOnly: boolean;
}

export const FRAMING_POLICY_SPECS: Record<FramingPolicyId, FramingPolicy> = {
  "centre-cover": {
    id: "centre-cover",
    label: "Centre cover",
    rule:
      "Scale the source so it covers the target and hold the window centred on the source frame (anchor 0.50, 0.50) for the " +
      "whole clip. Nothing is claimed about where the subject is: the centre of the frame is the deterministic fallback.",
    anchor: { x: 0.5, y: 0.5 },
    motion: "hold",
    explicitOnly: false,
  },
  "upper-third-bias": {
    id: "upper-third-bias",
    label: "Upper-third bias",
    rule:
      "Hold the window with its vertical anchor one third down the source (0.50, 0.33) instead of the exact centre, so the " +
      "window takes more of the lower frame than the upper. This is the headroom bias for a person-shaped frame: it is a " +
      "STATED RULE, not a measurement — nothing here detects a face or any other subject.",
    anchor: { x: 0.5, y: 1 / 3 },
    motion: "hold",
    explicitOnly: false,
  },
  "caption-safe-hold": {
    id: "caption-safe-hold",
    label: "Caption-safe hold",
    rule:
      "Hold the window on the anchor, then slide it along the cropping axis (never resizing it) to the position that keeps the " +
      "most of the source caption band in frame. The band is the subtitle engine's own geometry (SUBTITLE_SAFE_MARGINS, " +
      "CAPTION_LINE_HEIGHT_PX × MAX_CAPTION_LINES) scaled to the source height, so captions placed by that engine cannot be " +
      "cropped out of frame vertically.",
    anchor: { x: 0.5, y: 0.5 },
    motion: "hold",
    explicitOnly: false,
  },
  "pan-across-travel": {
    id: "pan-across-travel",
    label: "Pan across travel",
    rule:
      "Pan the window linearly over the clip from the lowest to the highest position it has on the cropping axis, using the full " +
      "travel the source allows, and hold the other axis. The RULE decides the path: no subject is tracked and no motion is " +
      "detected — choose it only when a rule-driven pan is what you want.",
    anchor: { x: 0.5, y: 0.5 },
    motion: "pan",
    explicitOnly: true,
  },
};

export function isFramingPolicyId(v: unknown): v is FramingPolicyId {
  return typeof v === "string" && (FRAMING_POLICIES as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Decision input / output                                             */
/* ------------------------------------------------------------------ */

export interface CaptionGeometry {
  /** The caption band in SOURCE pixels. */
  band: Rect;
  /** How the band was derived (the subtitle engine's constants). */
  basis: string;
}

export interface FramingDecisionInput {
  source: SourceFrame;
  target: TargetFrame;
  /** The scene has a captions clip on the timeline — real data. */
  captionsPresent: boolean;
  caption: CaptionGeometry | null;
  /** The scene carries narration — real data (used only by the upper-third rule). */
  narrationBeared: boolean;
  /** The scene's own declared source aspect, when it has one (cited in reasons). */
  sceneAspectDeclared: string | null;
  /** An explicit policy request (overrides the auto-selection). */
  requested: FramingPolicyId | null;
  /** An explicit anchor from an override; wins over the policy's own anchor. */
  requestedAnchor: AnchorPoint | null;
}

export interface CaptionCheck {
  present: boolean;
  band: Rect | null;
  bandBasis: string | null;
  /** Fraction of the band's ROWS kept inside the crop window. */
  verticalFraction: number;
  /** Fraction of the band's COLUMNS kept inside the crop window. */
  horizontalFraction: number;
  /** Fraction of the band's area kept inside the crop window. */
  areaFraction: number;
  /** The kept part of the band, in TARGET coordinates. */
  inTarget: Rect | null;
  /** Does the kept band land inside the target frame's caption-safe band? */
  insideTargetCaptionSafe: boolean | null;
  /** Row range of the source that the band occupies, as a readable string. */
  sourceRows: string | null;
  note: string;
}

export interface SafeAreaClamp {
  applied: boolean;
  /** The source action-safe rect the window was kept inside. */
  bounds: Rect;
  shiftPx: { x: number; y: number };
  note: string;
}

export interface FramingDecision {
  policy: {
    id: FramingPolicyId;
    label: string;
    rule: string;
    /** true when the caller asked for it; false when the engine selected it. */
    requested: boolean;
    anchor: AnchorPoint;
    anchorSource: "policy-rule" | "override-anchor";
  };
  /** What the engine's own selection would have been, always reported. */
  engineDefault: FramingPolicyId;
  selectedBecause: string;
  signals: { signal: string; value: string }[];
  alternatives: { policy: FramingPolicyId; note: string }[];
  baseCrop: CropResult;
  crop: CropResult;
  safeAreaClamp: SafeAreaClamp;
  caption: CaptionCheck;
  motion: {
    kind: "hold" | "pan";
    rule: string;
    /** Keyframe count the plan will emit for this path. */
    keyframeCount: number;
    travelPx: number;
    basis: "stated-rule" | "no-motion-data";
  };
  /** The keyframes are built by the caller (it knows the clip duration). */
  panStart: Rect;
  panEnd: Rect;
}

const KEYFRAMES_HOLD = 3;
const KEYFRAMES_PAN = 5;

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

/** What fraction of `band`'s ROWS survive inside `crop` (0..1). */
function keptRowsFraction(band: Rect, crop: Rect): number {
  if (band.height <= 0) return 0;
  const kept = Math.max(0, Math.min(band.y + band.height, crop.y + crop.height) - Math.max(band.y, crop.y));
  return Math.round((kept / band.height) * 10000) / 10000;
}

/** The source action-safe rect (the conventional 93% inset), rounded to px. */
export function sourceActionSafeRect(source: { widthPx: number; heightPx: number }): Rect {
  const w = Math.round(source.widthPx * ACTION_SAFE_FRACTION);
  const h = Math.round(source.heightPx * ACTION_SAFE_FRACTION);
  return {
    x: Math.round((source.widthPx - w) / 2),
    y: Math.round((source.heightPx - h) / 2),
    width: w,
    height: h,
  };
}

function captionCheck(
  decision: { crop: Rect; scale: number; targetSafe: Rect | null },
  caption: CaptionGeometry | null,
  present: boolean,
): CaptionCheck {
  if (!present || !caption) {
    return {
      present: false,
      band: null,
      bandBasis: null,
      verticalFraction: 0,
      horizontalFraction: 0,
      areaFraction: 0,
      inTarget: null,
      insideTargetCaptionSafe: null,
      sourceRows: null,
      note:
        "This scene has no captions clip on the timeline, so there is no caption band to protect. " +
        "The safe areas above are still reported for the target frame.",
    };
  }
  const { crop, scale } = decision;
  const band = caption.band;
  const overlap = intersectRect(band, crop);
  const inTarget = mapSourceRectToTarget(overlap, crop, scale);
  const targetSafe = decision.targetSafe;
  // Row and column retention are the meaningful numbers: a crop cuts rows or
  // columns, and each axis is measured on its own.
  const rowsKept = Math.max(0, Math.min(band.y + band.height, crop.y + crop.height) - Math.max(band.y, crop.y));
  const colsKept = Math.max(0, Math.min(band.x + band.width, crop.x + crop.width) - Math.max(band.x, crop.x));
  const verticalFraction = band.height > 0 ? Math.round((rowsKept / band.height) * 10000) / 10000 : 0;
  const horizontalFraction = band.width > 0 ? Math.round((colsKept / band.width) * 10000) / 10000 : 0;
  const safeOverlap = targetSafe ? retainedAreaRatio(inTarget, targetSafe) : 0;
  return {
    present: true,
    band: { ...band },
    bandBasis: caption.basis,
    verticalFraction,
    horizontalFraction,
    areaFraction: retainedAreaRatio(band, crop),
    inTarget: { ...inTarget },
    insideTargetCaptionSafe: targetSafe ? safeOverlap >= 0.9999 : null,
    sourceRows: `rows ${band.y}–${band.y + band.height} of the source`,
    note:
      `The caption band occupies rows ${band.y}–${band.y + band.height} of the source (${band.width}px wide, derived from the ` +
      `subtitle engine's own margins). The crop keeps ${pct(verticalFraction)} of its rows and ${pct(horizontalFraction)} of its ` +
      `columns (${pct(retainedAreaRatio(band, crop))} by area). The DELIVERED captions are placed fresh in the target frame by the ` +
      `subtitle engine inside the target's caption-safe band reported above — nothing here renders a caption.`,
  };
}

/**
 * Runs the policy selection and returns the full decision, including the
 * numeric signals behind the choice and the alternatives considered.
 */
export function decideFramingPolicy(input: FramingDecisionInput, targetSafe: Rect | null): FramingDecision {
  const { source, target } = input;
  const actionSafe = sourceActionSafeRect(source);
  const centred = coverCrop(source, target, { x: 0.5, y: 0.5 }, actionSafe);
  const captionPresent = input.captionsPresent && input.caption !== null;

  /* ------------------------------------------------ what the engine would pick */
  // The meaningful question for captions is ROW retention: a crop cuts rows, and
  // a caption band whose rows are cut is text that is gone from the frame.
  const centredCaption = captionPresent ? keptRowsFraction(input.caption!.band, centred.crop) : 1;
  const upperThird = coverCrop(source, target, { x: 0.5, y: 1 / 3 }, actionSafe);
  const upperThirdDiffers = !cropsEqual(upperThird.crop, centred.crop);

  let engineDefault: FramingPolicyId = "centre-cover";
  let selectedBecause: string;
  const signals: { signal: string; value: string }[] = [
    { signal: "source", value: `${source.widthPx}×${source.heightPx} (${source.aspect})` },
    { signal: "target", value: `${target.widthPx}×${target.heightPx} (${target.aspect})` },
    { signal: "scale", value: `${centred.scale}× (cover minimum)` },
    { signal: "crop window", value: `${centred.crop.width}×${centred.crop.height}px` },
    { signal: "travel", value: `${centred.travelPx.x}px horizontal, ${centred.travelPx.y}px vertical` },
  ];

  if (captionPresent && centredCaption < 0.9999 && centred.travelPx.y + centred.travelPx.x > 0) {
    engineDefault = "caption-safe-hold";
    selectedBecause =
      `the centred window keeps only ${pct(centredCaption)} of the source caption band's rows, and the crop has travel to fix it ` +
      `(${centred.travelPx.x}px horizontal, ${centred.travelPx.y}px vertical) — on-screen text must not be cropped out, so the ` +
      `window slides to the position that keeps the most of the band`;
    signals.push({ signal: "caption band rows kept (centred)", value: pct(centredCaption) });
    signals.push({ signal: "captions clip on the timeline", value: "yes" });
  } else if (upperThirdDiffers && input.narrationBeared && centred.travelPx.y > 0) {
    engineDefault = "upper-third-bias";
    selectedBecause =
      `the source is taller than the target on this axis, so the crop HAS ${centred.travelPx.y}px of vertical travel ` +
      `(${source.aspect} → ${target.aspect}), and the scene carries narration: the plan applies the stated upper-third headroom ` +
      `rule for a person-shaped frame. No subject position was detected — this is the rule, not a measurement`;
    signals.push({ signal: "vertical travel", value: `${centred.travelPx.y}px` });
    signals.push({ signal: "scene narration", value: "present" });
  } else if (captionPresent && centredCaption >= 0.9999) {
    selectedBecause =
      `the cover crop spans the source rows the caption band occupies, so the band survives the crop untouched ` +
      `(${pct(centredCaption)} of its rows kept without moving the window) — no correction is needed`;
    signals.push({ signal: "caption band rows kept (centred)", value: pct(centredCaption) });
    signals.push({ signal: "captions clip on the timeline", value: "yes" });
  } else {
    selectedBecause =
      `no policy's trigger fired: the crop cuts no caption rows${captionPresent ? "" : " (this scene has no captions clip)"}, ` +
      `there is ${centred.travelPx.y > 0 ? `${centred.travelPx.y}px` : "no"} vertical travel and ` +
      `${input.narrationBeared ? "the scene is narration-bearing" : "the scene carries no narration"}, so the deterministic ` +
      `fallback holds the source centre — the honest choice when nothing locates a subject`;
    signals.push({ signal: "vertical travel", value: `${centred.travelPx.y}px` });
    signals.push({ signal: "scene narration", value: input.narrationBeared ? "present" : "absent" });
  }

  /* ------------------------------------------------------- apply the choice */
  const requested = input.requested;
  const chosen: FramingPolicyId = requested ?? engineDefault;
  const spec = FRAMING_POLICY_SPECS[chosen];
  const anchor = input.requestedAnchor ? { ...input.requestedAnchor } : { ...spec.anchor };
  const anchorSource: "policy-rule" | "override-anchor" = input.requestedAnchor ? "override-anchor" : "policy-rule";
  const base = coverCrop(source, target, anchor, actionSafe);

  let working: CropResult = base;
  let captionSlid = false;
  let captionSlideNote = "";
  if (chosen === "caption-safe-hold" && input.caption) {
    const axis: "x" | "y" = base.travelPx.y > 0 ? "y" : "x";
    const best = bestWindowFor(base.crop, { widthPx: source.widthPx, heightPx: source.heightPx }, input.caption.band, axis);
    const moved: CropResult = {
      ...base,
      crop: best.crop,
      cropNormalized: {
        x: Math.round((best.crop.x / source.widthPx) * 10000) / 10000,
        y: Math.round((best.crop.y / source.heightPx) * 10000) / 10000,
        width: Math.round((best.crop.width / source.widthPx) * 10000) / 10000,
        height: Math.round((best.crop.height / source.heightPx) * 10000) / 10000,
      },
      offsetPx: { x: best.crop.x, y: best.crop.y },
      anchorOffsetPx: {
        x: Math.round(best.crop.x + best.crop.width / 2 - anchor.x * source.widthPx),
        y: Math.round(best.crop.y + best.crop.height / 2 - anchor.y * source.heightPx),
      },
    };
    working = moved;
    captionSlid = best.crop.y !== base.crop.y || best.crop.x !== base.crop.x;
    captionSlideNote =
      `the window was slid ${best.travelUsed >= 0 ? "+" : ""}${best.travelUsed}px on the ${axis} axis, keeping ` +
      `${pct(best.retained)} of the caption band by area (the window size never changed)`;
    signals.push({ signal: "caption slide", value: captionSlideNote });
  }

  /* ------------------------------------ the always-on action-safe invariant */
  const clamp = clampInside(working.crop, actionSafe);
  const clampApplied = clamp.applied.x || clamp.applied.y;
  if (clampApplied) {
    working = {
      ...working,
      crop: clamp.crop,
      cropNormalized: {
        x: Math.round((clamp.crop.x / source.widthPx) * 10000) / 10000,
        y: Math.round((clamp.crop.y / source.heightPx) * 10000) / 10000,
        width: working.cropNormalized.width,
        height: working.cropNormalized.height,
      },
      offsetPx: { x: clamp.crop.x, y: clamp.crop.y },
      anchorOffsetPx: {
        x: Math.round(clamp.crop.x + clamp.crop.width / 2 - anchor.x * source.widthPx),
        y: Math.round(clamp.crop.y + clamp.crop.height / 2 - anchor.y * source.heightPx),
      },
    };
    signals.push({ signal: "action-safe clamp", value: `x ${clamp.shiftPx.x >= 0 ? "+" : ""}${clamp.shiftPx.x}px, y ${clamp.shiftPx.y >= 0 ? "+" : ""}${clamp.shiftPx.y}px` });
  }

  const safeAreaClamp: SafeAreaClamp = {
    applied: clampApplied,
    bounds: actionSafe,
    shiftPx: clamp.shiftPx,
    note: clampApplied
      ? `The policy's window reached past the source's action-safe rect (${actionSafe.x},${actionSafe.y} ${actionSafe.width}×${actionSafe.height}); ` +
        `${clamp.note}. The window SIZE is unchanged — only its position.`
      : `No shift was needed: the window (${working.crop.width}×${working.crop.height} at ${working.crop.x},${working.crop.y}) is already inside the source's ` +
        `action-safe rect (${actionSafe.x},${actionSafe.y} ${actionSafe.width}×${actionSafe.height}) on every axis where it fits — ${clamp.note}.`,
  };

  /* --------------------------------------------------------------- motion */
  const motionKind = spec.motion;
  let panStart = working.crop;
  let panEnd = working.crop;
  if (motionKind === "pan") {
    const horizontal = working.travelPx.x >= working.travelPx.y;
    const maxOffset = horizontal ? working.travelPx.x : working.travelPx.y;
    if (horizontal) {
      panStart = { x: 0, y: working.crop.y, width: working.crop.width, height: working.crop.height };
      panEnd = { x: maxOffset, y: working.crop.y, width: working.crop.width, height: working.crop.height };
    } else {
      panStart = { x: working.crop.x, y: 0, width: working.crop.width, height: working.crop.height };
      panEnd = { x: working.crop.x, y: maxOffset, width: working.crop.width, height: working.crop.height };
    }
  }

  const caption = captionCheck({ crop: working.crop, scale: working.scale, targetSafe }, input.caption, captionPresent);

  /* ---------------------------------------------------------- alternatives */
  const alternatives: { policy: FramingPolicyId; note: string }[] = [];
  for (const id of FRAMING_POLICIES) {
    if (id === chosen) continue;
    const other = FRAMING_POLICY_SPECS[id];
    if (id === "caption-safe-hold") {
      alternatives.push({
        policy: id,
        note: captionPresent
          ? `would slide the window to keep the caption band — the band keeps ${pct(caption.areaFraction)} by area as chosen`
          : "not applicable: this scene has no captions clip, so there is no caption band to protect",
      });
    } else if (id === "upper-third-bias") {
      alternatives.push({
        policy: id,
        note: upperThirdDiffers
          ? `would move the window to y=${upperThird.crop.y} (anchor 0.33, ${upperThird.travelPx.y}px of vertical travel exists) — a stated rule for a person-shaped frame, not a measurement`
          : `would not change the window: the crop keeps the full source height on the ${target.aspect} target (no vertical travel), so the upper-third anchor has nothing to move`,
      });
    } else if (id === "pan-across-travel") {
      alternatives.push({
        policy: id,
        note:
          working.travelPx.x + working.travelPx.y > 0
            ? `explicit only: would pan across ${working.travelPx.x}px horizontal / ${working.travelPx.y}px vertical of travel over the clip — a stated rule, no subject tracking`
            : "not applicable: this crop has no travel, so there is nothing to pan across",
      });
    } else {
      alternatives.push({
        policy: id,
        note: `would keep the window at ${centred.crop.x},${centred.crop.y} (${centred.crop.width}×${centred.crop.height}px) — the centre fallback`,
      });
    }
  }

  const selectedBecauseFinal =
    (requested ? `requested explicitly (policy "${requested}"); ` : "") +
    (chosen === engineDefault
      ? selectedBecause
      : `the engine's own choice would have been "${engineDefault}" (${selectedBecause}), and the request overrode it`) +
    (captionSlid ? `; ${captionSlideNote}` : "");

  return {
    policy: { id: chosen, label: spec.label, rule: spec.rule, requested: requested !== null, anchor, anchorSource },
    engineDefault,
    selectedBecause: selectedBecauseFinal,
    signals,
    alternatives,
    baseCrop: base,
    crop: working,
    safeAreaClamp,
    caption,
    motion: {
      kind: motionKind,
      rule:
        motionKind === "pan"
          ? `keyframes interpolate the window linearly from ${panStart.x},${panStart.y} to ${panEnd.x},${panEnd.y} over the clip's duration (stated rule, no subject tracking)`
          : `absolute hold: every keyframe is the same window (${working.crop.x},${working.crop.y} ${working.crop.width}×${working.crop.height}) — no motion data exists, so nothing pans`,
      keyframeCount: motionKind === "pan" ? KEYFRAMES_PAN : KEYFRAMES_HOLD,
      travelPx: motionKind === "pan" ? (working.travelPx.x >= working.travelPx.y ? working.travelPx.x : working.travelPx.y) : 0,
      basis: motionKind === "pan" ? "stated-rule" : "no-motion-data",
    },
    panStart,
    panEnd,
  };
}

/* ------------------------------------------------------------------ */
/* Subject anchoring — the honest check                                */
/* ------------------------------------------------------------------ */

export interface AnchorCheckField {
  field: string;
  /** What the field actually holds in this data model. */
  holds: string;
  /** Does it locate a subject inside the frame? */
  locatesSubject: boolean;
}

export interface AnchorCheck {
  known: false;
  /** The anchor the plan used, and what it is. */
  anchorKind: "rule-position";
  checked: AnchorCheckField[];
  reason: string;
}

/**
 * The subject anchor is UNKNOWN, and this is the evidence.
 *
 * Every field in the model that could plausibly have held a subject position was
 * checked; each one is listed with what it really holds. A face/object detector
 * that is not connected must never produce a plausible-looking box, so no anchor
 * is invented: the plan uses a stated rule position (the policy's anchor) and the
 * caller gets the detector gate alongside it.
 */
export function anchorCheck(): AnchorCheck {
  return {
    known: false,
    anchorKind: "rule-position",
    checked: [
      {
        field: "Scene.aspectRatio",
        holds: "the SHAPE of the scene's frame (SIXTEEN_NINE, NINE_SIXTEEN, ONE_ONE, FOUR_THREE, TWENTY_ONE_NINE, FOUR_FIVE) — a frame ratio, not a position",
        locatesSubject: false,
      },
      {
        field: "Asset.width / Asset.height",
        holds: "the real pixel dimensions of an uploaded or generated asset — used here as the SOURCE frame, never as a subject position",
        locatesSubject: false,
      },
      {
        field: "Asset.metadata (Json)",
        holds: "free-form; this app writes only metadata.library (favourite / collections / tags / lastUsedAt) and metadata.upload.originalName — no region, box or focal point is ever written",
        locatesSubject: false,
      },
      {
        field: "Subtitle (text / format / s3Key / sceneId)",
        holds: "caption CONTENT and its file key — no on-screen position, no bounding box",
        locatesSubject: false,
      },
      {
        field: "subtitles.avoidRegions()",
        holds: "a deterministic solver that AVOIDS the regions it is handed; the regions themselves would come from a vision provider, and nothing in this app produces one",
        locatesSubject: false,
      },
      {
        field: "Timeline Clip",
        holds: "start/end ms, track, sceneId, name, transition, grade, subtitleStyle — timing and styling, no geometry at all",
        locatesSubject: false,
      },
    ],
    reason:
      "No field in the data model locates a face, chart or line of text inside a frame, so the subject anchor is UNKNOWN. " +
      "The plan therefore uses a stated rule position (the selected policy's anchor) and reports it as such; it never invents a " +
      "subject position and never renders a plausible-looking detection box. Connecting a real face/object detector is the only " +
      "thing that would change this, and the detector gate in this response names the env var that would enable it.",
  };
}
