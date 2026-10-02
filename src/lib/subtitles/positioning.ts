/**
 * Phase 4 Block 3 — Subtitle smart positioning (deterministic, pure, no IO).
 *
 * Places caption cues so they NEVER cover faces, on-screen text, charts or
 * other subjects. Region detection itself arrives with provider-based vision
 * in a later phase — the engine deterministically AVOIDS any regions it is
 * given (the Phase 5 vision model will supply them). Coordinates are in
 * top-left-origin pixels; SUBTITLE_SAFE_MARGINS is a 1080p base that the
 * renderer scales with the frame.
 *
 * Reason codes:
 *  - "default"       bottom-center within safe margins, nothing to avoid
 *  - "avoided:<lbl>" moved to the nearest free spot above a blocking region
 *  - "safe-margin"   last-resort position within the safe margins (used only
 *                    when a region covers every free slot — flagged honestly)
 */

export type RegionLabel = "face" | "text" | "chart" | "subject";

export interface Region {
  label: RegionLabel;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Base safe margins in px on a 1080p frame (renderer scales). */
export const SUBTITLE_SAFE_MARGINS = { x: 48, y: 48 } as const;

export type PlacementReason = "default" | `avoided:${RegionLabel}` | "safe-margin";

export interface CuePlacement {
  x: number;
  y: number;
  width: number;
  maxLines: number;
  reason: PlacementReason;
}

export interface AvoidRegionsInput {
  cueTexts: string[];
  regions?: Region[];
  videoWidth: number;
  videoHeight: number;
}

/** Line height estimate for caption text at 1080p base (px). */
export const CAPTION_LINE_HEIGHT_PX = 64;
/** Max on-screen lines per cue (dynamic captions). */
export const MAX_CAPTION_LINES = 2;
/** Vertical gap kept between a cue and a region it dodges (px). */
export const AVOID_GAP_PX = 24;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function normalizeRegions(regions: Region[] | undefined): Region[] {
  if (!regions) return [];
  return regions
    .filter(
      (r) =>
        r &&
        ["face", "text", "chart", "subject"].includes(r.label) &&
        Number.isFinite(r.x) &&
        Number.isFinite(r.y) &&
        Number.isFinite(r.w) &&
        Number.isFinite(r.h) &&
        r.w > 0 &&
        r.h > 0,
    )
    .map((r) => ({
      label: r.label,
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      w: Math.round(r.w),
      h: Math.round(r.h),
    }));
}

/**
 * Deterministic placement for every cue text. Same input always yields the
 * same placements.
 *
 * Strategy per cue:
 *  1. Start at the safe-margin default: bottom-center, y = videoHeight - safeY
 *     - height. Free of regions → reason "default".
 *  2. A region occupies the default spot → walk candidate positions upward
 *     (one line height at a time, minimum safeY) and take the first spot that
 *     intersects NO region → reason "avoided:<label of the first blocker>".
 *  3. Every slot is blocked → fall back to the topmost safe position and flag
 *     reason "safe-margin" (honest last resort; the Phase 5 renderer re-checks
 *     against real frames).
 */
export function avoidRegions(input: AvoidRegionsInput): CuePlacement[] {
  const safeX = Math.max(0, SUBTITLE_SAFE_MARGINS.x);
  const safeY = Math.max(0, SUBTITLE_SAFE_MARGINS.y);
  const videoWidth = Math.max(1, Math.round(input.videoWidth));
  const videoHeight = Math.max(1, Math.round(input.videoHeight));
  const regions = normalizeRegions(input.regions);

  const width = Math.max(160, videoWidth - 2 * safeX);
  const height = CAPTION_LINE_HEIGHT_PX * MAX_CAPTION_LINES;
  const x = Math.round((videoWidth - width) / 2);
  const defaultY = Math.max(safeY, videoHeight - safeY - height);

  // Candidate y positions: bottom-center first, then stepping up by one line
  // height until the top safe margin.
  const candidates: number[] = [];
  for (let y = defaultY; y >= safeY; y -= CAPTION_LINE_HEIGHT_PX) candidates.push(y);
  if (candidates.length === 0 || candidates[candidates.length - 1] !== safeY) candidates.push(safeY);

  return (input.cueTexts ?? []).map((text) => {
    const linesForCue = Math.max(1, (text ?? "").split("\n").filter((l) => l.length > 0).length);
    const maxLines = Math.min(MAX_CAPTION_LINES, Math.max(1, linesForCue));
    const cueHeight = CAPTION_LINE_HEIGHT_PX * maxLines;
    const cueRect = (y: number): Rect => ({ x, y, w: width, h: cueHeight });

    // 1) Default spot.
    const blockersAtDefault = regions.filter((r) => rectsIntersect(r, cueRect(defaultY)));
    if (blockersAtDefault.length === 0) {
      return { x, y: defaultY, width, maxLines, reason: "default" as PlacementReason };
    }

    // 2) Scan upward for the first region-free position.
    let moved: { y: number } | null = null;
    for (const y of candidates) {
      if (y === defaultY) continue;
      if (regions.every((r) => !rectsIntersect(r, cueRect(y)))) {
        moved = { y };
        break;
      }
    }
    if (moved) {
      return {
        x,
        y: moved.y,
        width,
        maxLines,
        reason: `avoided:${blockersAtDefault[0].label}` as PlacementReason,
      };
    }

    // 3) Everything blocked — safe-margin last resort (top of the safe area).
    return { x, y: safeY, width, maxLines, reason: "safe-margin" as PlacementReason };
  });
}