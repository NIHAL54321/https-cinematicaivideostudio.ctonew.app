/**
 * Phase 5 Block 5b — OUTPUT FORMATS + SAFE AREAS (pure, client-safe).
 *
 * The four delivery frames this block plans for: 16:9 (long-form), 9:16
 * (Shorts / Reels / TikToks), 1:1 (feed square) and 4:5 (portrait feed). Every
 * number here is a real, inspectable constant:
 *
 *   - the delivery resolution in pixels,
 *   - the aspect VALUE (width / height) used by the crop math in ./geometry,
 *   - the action-safe and title-safe fractions of the frame (the broadcast
 *     convention: 93% action-safe, 90% title-safe — stated, not invented), and
 *   - the caption-safe band, derived from the SUBTITLE engine's own constants
 *     (`SUBTITLE_SAFE_MARGINS`, `CAPTION_LINE_HEIGHT_PX`, `MAX_CAPTION_LINES`
 *     in src/lib/subtitles/positioning.ts) scaled to the frame's height.
 *
 * Reusing the subtitle engine's margins (rather than inventing a second
 * convention) is the point: a caption placed by `avoidRegions` is placed inside
 * THIS band, so a crop window that keeps the band cannot crop captions out.
 *
 * Nothing in this file renders, encodes or upscales anything — it is arithmetic
 * on declared delivery targets.
 */
import {
  CAPTION_LINE_HEIGHT_PX,
  MAX_CAPTION_LINES,
  SUBTITLE_SAFE_MARGINS,
} from "../subtitles/positioning";

/* ------------------------------------------------------------------ */
/* Rectangles + safe-area conventions                                  */
/* ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Action-safe: the conventional broadcast margin whose outside may be cut. */
export const ACTION_SAFE_FRACTION = 0.93;
/** Title-safe: the tighter margin all on-screen text should stay inside. */
export const TITLE_SAFE_FRACTION = 0.9;
/** The height the caption-safe band is derived from (the subtitle engine's base). */
export const CAPTION_BASE_HEIGHT_PX = 1080;

/* ------------------------------------------------------------------ */
/* The four delivery formats                                          */
/* ------------------------------------------------------------------ */

export const FRAME_FORMATS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type FrameFormatId = (typeof FRAME_FORMATS)[number];

/** The engine's default when neither the request, an override nor project data says. */
export const DEFAULT_FRAME_FORMAT: FrameFormatId = "16:9";

export interface FrameFormatSpec {
  id: FrameFormatId;
  label: string;
  /** The aspect as a display string. */
  aspect: string;
  /** width / height — the single number the crop math uses. */
  aspectValue: number;
  /** Delivery width in px. */
  widthPx: number;
  /** Delivery height in px. */
  heightPx: number;
  platforms: string[];
  /** Delivery expectations, stated per format. */
  deliveryNotes: string[];
}

export const FRAME_FORMAT_SPECS: Record<FrameFormatId, FrameFormatSpec> = {
  "16:9": {
    id: "16:9",
    label: "16:9 Landscape",
    aspect: "16:9",
    aspectValue: 16 / 9,
    widthPx: 1920,
    heightPx: 1080,
    platforms: ["YouTube long-form", "Vimeo", "embedded player"],
    deliveryNotes: [
      "Long-form master. 1920×1080 (1080p) is the delivery frame; 3840×2160 exists but needs a 4K source or an upscale.",
      "A 16:9 target from a 16:9 source crops nothing: the crop window is the whole frame and the scale is 1.0.",
    ],
  },
  "9:16": {
    id: "9:16",
    label: "9:16 Vertical",
    aspect: "9:16",
    aspectValue: 9 / 16,
    widthPx: 1080,
    heightPx: 1920,
    platforms: ["YouTube Shorts", "Instagram Reels", "TikTok"],
    deliveryNotes: [
      "Vertical delivery is 1080×1920. A 16:9 source keeps its FULL height and only its centre columns, so the crop is an upscale of the kept columns — read the reported upscale factor before promising 1080p.",
      "Kept columns × upscale = 1080: the engine reports both numbers per clip instead of assuming the source is big enough.",
    ],
  },
  "1:1": {
    id: "1:1",
    label: "1:1 Square",
    aspect: "1:1",
    aspectValue: 1,
    widthPx: 1080,
    heightPx: 1080,
    platforms: ["feed posts", "LinkedIn", "X"],
    deliveryNotes: [
      "Square delivery is 1080×1080. From a 16:9 source the full height is kept and the sides are cropped.",
      "Square is the least destructive crop of the three narrow formats for a 16:9 master: it keeps the full height and 56% of the width at 1080p.",
    ],
  },
  "4:5": {
    id: "4:5",
    label: "4:5 Portrait",
    aspect: "4:5",
    aspectValue: 4 / 5,
    widthPx: 1080,
    heightPx: 1350,
    platforms: ["Instagram feed portrait", "Facebook feed"],
    deliveryNotes: [
      "Portrait feed delivery is 1080×1350 — taller than it is wide, still shorter than 9:16.",
      "From a 16:9 source this keeps the full height and crops more width than 1:1 but far less than 9:16.",
    ],
  },
};

export function isFrameFormatId(v: unknown): v is FrameFormatId {
  return typeof v === "string" && (FRAME_FORMATS as readonly string[]).includes(v);
}

export function formatSpec(id: FrameFormatId): FrameFormatSpec {
  return FRAME_FORMAT_SPECS[id];
}

/* ------------------------------------------------------------------ */
/* Safe areas                                                          */
/* ------------------------------------------------------------------ */

export interface SafeAreas {
  actionSafe: Rect;
  titleSafe: Rect;
  /** Where the subtitle engine may place a caption (bottom-centre band). */
  captionSafe: Rect;
  /** How the caption band was derived — the subtitle engine's own constants. */
  captionBasis: string;
}

function insetRect(width: number, height: number, fraction: number): Rect {
  const w = Math.round(width * fraction);
  const h = Math.round(height * fraction);
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
}

/**
 * The caption band for a frame of this height, scaled from the subtitle
 * engine's 1080p base. `avoidRegions` lays a cue out as
 * `x = (W - (W - 2*safeX)) / 2`, `y = H - safeY - lineHeight*lines` with at most
 * MAX_CAPTION_LINES lines, so this rect is exactly the region a placed cue
 * occupies.
 */
export function captionBand(frame: { widthPx: number; heightPx: number }): {
  rect: Rect;
  marginX: number;
  marginY: number;
  lineHeight: number;
  maxLines: number;
  basis: string;
} {
  const scale = frame.heightPx / CAPTION_BASE_HEIGHT_PX;
  const marginX = Math.round(SUBTITLE_SAFE_MARGINS.x * scale);
  const marginY = Math.round(SUBTITLE_SAFE_MARGINS.y * scale);
  const lineHeight = Math.round(CAPTION_LINE_HEIGHT_PX * scale);
  const bandHeight = lineHeight * MAX_CAPTION_LINES;
  const width = Math.max(160, frame.widthPx - 2 * marginX);
  return {
    rect: {
      x: Math.round((frame.widthPx - width) / 2),
      y: Math.max(0, frame.heightPx - marginY - bandHeight),
      width,
      height: bandHeight,
    },
    marginX,
    marginY,
    lineHeight,
    maxLines: MAX_CAPTION_LINES,
    basis:
      `scaled ×${Math.round(scale * 1000) / 1000} from the subtitle engine's 1080p base: ` +
      `${SUBTITLE_SAFE_MARGINS.x}px side margin, ${SUBTITLE_SAFE_MARGINS.y}px bottom margin, ` +
      `${CAPTION_LINE_HEIGHT_PX}px line height × ${MAX_CAPTION_LINES} lines`,
  };
}

export function safeAreas(frame: { widthPx: number; heightPx: number }): SafeAreas {
  const cap = captionBand(frame);
  return {
    actionSafe: insetRect(frame.widthPx, frame.heightPx, ACTION_SAFE_FRACTION),
    titleSafe: insetRect(frame.widthPx, frame.heightPx, TITLE_SAFE_FRACTION),
    captionSafe: cap.rect,
    captionBasis: cap.basis,
  };
}

/* ------------------------------------------------------------------ */
/* Source aspects (what the project's own metadata can tell us)         */
/* ------------------------------------------------------------------ */

/**
 * The Prisma `AspectRatio` enum values and the nominal frame each describes.
 * A scene that carries one of these is telling us the SHAPE of its frame —
 * not where any subject sits inside it.
 */
export interface SourceAspectSpec {
  /** The Prisma enum value. */
  enumValue: string;
  label: string;
  aspectValue: number;
  widthPx: number;
  heightPx: number;
}

export const SOURCE_ASPECTS: Record<string, SourceAspectSpec> = {
  SIXTEEN_NINE: { enumValue: "SIXTEEN_NINE", label: "16:9", aspectValue: 16 / 9, widthPx: 1920, heightPx: 1080 },
  NINE_SIXTEEN: { enumValue: "NINE_SIXTEEN", label: "9:16", aspectValue: 9 / 16, widthPx: 1080, heightPx: 1920 },
  ONE_ONE: { enumValue: "ONE_ONE", label: "1:1", aspectValue: 1, widthPx: 1080, heightPx: 1080 },
  FOUR_THREE: { enumValue: "FOUR_THREE", label: "4:3", aspectValue: 4 / 3, widthPx: 1440, heightPx: 1080 },
  TWENTY_ONE_NINE: {
    enumValue: "TWENTY_ONE_NINE",
    label: "21:9",
    aspectValue: 21 / 9,
    widthPx: 2560,
    heightPx: 1080,
  },
  FOUR_FIVE: { enumValue: "FOUR_FIVE", label: "4:5", aspectValue: 4 / 5, widthPx: 1080, heightPx: 1350 },
};

export function sourceAspectSpec(enumValue: unknown): SourceAspectSpec | null {
  if (typeof enumValue !== "string") return null;
  return SOURCE_ASPECTS[enumValue] ?? null;
}

/**
 * The delivery format a source aspect naturally belongs to. 4:3 and 21:9 have
 * no entry in the four-format catalogue, so they map to the nearest format and
 * the caller is told that it was a stated fallback (never a silent guess).
 */
export function formatForAspectValue(aspectValue: number): { id: FrameFormatId; exact: boolean; note: string } {
  const match = FRAME_FORMATS.find((id) => Math.abs(FRAME_FORMAT_SPECS[id].aspectValue - aspectValue) < 0.0001);
  if (match) {
    return { id: match, exact: true, note: `the source aspect ${FRAME_FORMAT_SPECS[match].aspect} has an exact delivery format` };
  }
  const id: FrameFormatId = aspectValue >= 1.2 ? "16:9" : aspectValue >= 0.9 ? "1:1" : aspectValue >= 0.7 ? "4:5" : "9:16";
  return {
    id,
    exact: false,
    note:
      `the source aspect ${Math.round(aspectValue * 1000) / 1000} has no exact delivery format in the catalogue ` +
      `(${FRAME_FORMATS.join(", ")}); the plan falls back to the nearest format, ${FRAME_FORMAT_SPECS[id].aspect} — stated, not guessed`,
  };
}

/* ------------------------------------------------------------------ */
/* Client-facing views                                                 */
/* ------------------------------------------------------------------ */

/** One format exactly as the panel renders it: resolution, safe areas, notes. */
export function formatView(spec: FrameFormatSpec): Record<string, unknown> {
  const frame = { widthPx: spec.widthPx, heightPx: spec.heightPx };
  const safe = safeAreas(frame);
  return {
    id: spec.id,
    label: spec.label,
    aspect: spec.aspect,
    aspectValue: Math.round(spec.aspectValue * 10000) / 10000,
    widthPx: spec.widthPx,
    heightPx: spec.heightPx,
    resolution: `${spec.widthPx}×${spec.heightPx}`,
    orientation: spec.aspectValue > 1.0001 ? "landscape" : spec.aspectValue < 0.9999 ? "portrait" : "square",
    platforms: [...spec.platforms],
    deliveryNotes: [...spec.deliveryNotes],
    safeAreas: {
      titleSafe: { ...safe.titleSafe, fraction: TITLE_SAFE_FRACTION },
      actionSafe: { ...safe.actionSafe, fraction: ACTION_SAFE_FRACTION },
      captionSafe: { ...safe.captionSafe, basis: safe.captionBasis },
    },
  };
}

export function listFormatViews(): Record<string, unknown>[] {
  return FRAME_FORMATS.map((id) => formatView(FRAME_FORMAT_SPECS[id]));
}
