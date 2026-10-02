/**
 * Phase 5 Block 5b — CROP / SAFE-AREA GEOMETRY (pure, deterministic, no IO).
 *
 * Everything here is arithmetic on declared frames: a SOURCE frame (real pixel
 * dimensions where the project has them, otherwise a stated nominal frame) and a
 * TARGET delivery format from ./formats. The functions compute, and report
 * verbatim:
 *
 *   - the cover-crop window in source pixels AND normalized units,
 *   - the derived scale (target px per source px) — the same number is the
 *     upscale factor applied to the kept columns/rows,
 *   - how far the window can travel on each axis before leaving the source,
 *   - where the window actually sits inside that travel (the anchor's effect),
 *   - what fraction of the source (and of the source's ACTION-SAFE rect) the
 *     crop retains,
 *   - the mapping of any source rect into target coordinates, and
 *   - the retention of the subtitle engine's caption band.
 *
 * HONESTY: none of this detects anything. The anchor is a point the CALLER
 * states (a rule position such as the frame centre); whether that point is
 * where the subject actually is cannot be known from the data this app stores,
 * and ./policies.ts says so explicitly (see `AnchorResolution` there).
 *
 * Rounding: every pixel figure is an integer. Windows are rounded, then
 * re-clamped so `x + width <= source.widthPx` — a window can never leave the
 * source frame, which is what makes the mirrored numbers trustworthy.
 */
import type { Rect } from "./formats";

export interface SourceFrame {
  widthPx: number;
  heightPx: number;
  /** Display aspect, e.g. "16:9". */
  aspect: string;
  aspectValue: number;
}

export interface TargetFrame {
  widthPx: number;
  heightPx: number;
  aspect: string;
  aspectValue: number;
}

/** A normalized point in source coordinates (0..1 on each axis). */
export interface AnchorPoint {
  x: number;
  y: number;
}

export interface CropResult {
  /** Target px per source px. Identical to the upscale applied to the kept region. */
  scale: number;
  /** The kept window, in source pixels. */
  crop: Rect;
  /** The same window, normalized to the source frame (0..1). */
  cropNormalized: { x: number; y: number; width: number; height: number };
  /** How far the window may move on each axis before it leaves the source. */
  travelPx: { x: number; y: number };
  /** Where the window sits inside its travel, in px from the low end. */
  offsetPx: { x: number; y: number };
  /** The anchor as resolved, normalized in source coordinates. */
  anchor: AnchorPoint;
  /** How far the anchor ended up from the window centre (px, after clamping). */
  anchorOffsetPx: { x: number; y: number };
  /** Fractions of the source the window keeps. */
  retained: { widthFraction: number; heightFraction: number; areaFraction: number };
  /** Fraction of the SOURCE action-safe rect that stays inside the window (per axis + area). */
  sourceActionSafeRetained: { xFraction: number; yFraction: number; areaFraction: number };
}

function clamp(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Area of a rect, 0 for an empty/degenerate rect. */
export function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/** `inner` ∩ `outer` (empty when they do not overlap). */
export function intersectRect(inner: Rect, outer: Rect): Rect {
  const x = Math.max(inner.x, outer.x);
  const y = Math.max(inner.y, outer.y);
  const right = Math.min(inner.x + inner.width, outer.x + outer.width);
  const bottom = Math.min(inner.y + inner.height, outer.y + outer.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** What fraction of `inner`'s area survives inside `outer` (0..1). */
export function retainedAreaRatio(inner: Rect, outer: Rect): number {
  const total = rectArea(inner);
  if (total <= 0) return 0;
  return round4(rectArea(intersectRect(inner, outer)) / total);
}

/**
 * Map a source-pixel rect into target-frame coordinates through a crop window.
 * The result can fall partly or fully outside the target frame — the caller
 * measures the overlap rather than assuming it is inside.
 */
export function mapSourceRectToTarget(rect: Rect, crop: Rect, scale: number): Rect {
  return {
    x: Math.round((rect.x - crop.x) * scale),
    y: Math.round((rect.y - crop.y) * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
}

/**
 * The cover crop: scale the source so it COVERS the target, then keep the
 * window whose centre is the anchor point. Never crops less than necessary
 * (scale is the cover minimum), never leaves the source, and the kept region
 * exactly fills the target at `scale`.
 */
export function coverCrop(
  source: SourceFrame,
  target: TargetFrame,
  anchor: AnchorPoint,
  actionSafeSource?: Rect,
): CropResult {
  const sw = Math.max(1, Math.round(source.widthPx));
  const sh = Math.max(1, Math.round(source.heightPx));
  const tw = Math.max(1, Math.round(target.widthPx));
  const th = Math.max(1, Math.round(target.heightPx));

  const scale = Math.max(tw / sw, th / sh);
  const visibleW = tw / scale;
  const visibleH = th / scale;
  // Integer window first, then the travel measured on the INTEGER window — so
  // `travelPx` is exactly the distance the reported window can move.
  const width = Math.min(sw, Math.max(1, Math.round(visibleW)));
  const height = Math.min(sh, Math.max(1, Math.round(visibleH)));
  const travelX = Math.max(0, sw - width);
  const travelY = Math.max(0, sh - height);

  // Anchor position, clamped into the feasible travel range.
  const wantedX = clamp(anchor.x, 0, 1) * sw - visibleW / 2;
  const wantedY = clamp(anchor.y, 0, 1) * sh - visibleH / 2;
  const x = clamp(Math.round(clamp(wantedX, 0, travelX)), 0, travelX);
  const y = clamp(Math.round(clamp(wantedY, 0, travelY)), 0, travelY);
  const crop: Rect = { x, y, width, height };

  const safe = actionSafeSource ?? {
    x: Math.round(sw * 0.035),
    y: Math.round(sh * 0.035),
    width: Math.round(sw * 0.93),
    height: Math.round(sh * 0.93),
  };

  return {
    scale: round4(scale),
    crop,
    cropNormalized: {
      x: round4(x / sw),
      y: round4(y / sh),
      width: round4(width / sw),
      height: round4(height / sh),
    },
    travelPx: { x: travelX, y: travelY },
    offsetPx: { x, y },
    anchor: { x: round4(clamp(anchor.x, 0, 1)), y: round4(clamp(anchor.y, 0, 1)) },
    anchorOffsetPx: {
      x: Math.round(x + width / 2 - clamp(anchor.x, 0, 1) * sw),
      y: Math.round(y + height / 2 - clamp(anchor.y, 0, 1) * sh),
    },
    retained: {
      widthFraction: round4(width / sw),
      heightFraction: round4(height / sh),
      areaFraction: round4((width * height) / (sw * sh)),
    },
    sourceActionSafeRetained: {
      xFraction: round4(clamp(safe.width > 0 ? Math.min(safe.width, intersectRect(safe, crop).width) / safe.width : 0, 0, 1)),
      yFraction: round4(clamp(safe.height > 0 ? Math.min(safe.height, intersectRect(safe, crop).height) / safe.height : 0, 0, 1)),
      areaFraction: retainedAreaRatio(safe, crop),
    },
  };
}

/**
 * Clamp a window inside a bounding rect on the axes where it fits. Returns the
 * moved window plus what the clamp actually did (per axis), so a policy can
 * report the real shift instead of claiming a rule it did not need to apply.
 */
export function clampInside(
  crop: Rect,
  bounds: Rect,
): { crop: Rect; applied: { x: boolean; y: boolean }; shiftPx: { x: number; y: number }; note: string } {
  const canX = crop.width <= bounds.width;
  const canY = crop.height <= bounds.height;
  const x = canX ? clamp(crop.x, bounds.x, bounds.x + bounds.width - crop.width) : crop.x;
  const y = canY ? clamp(crop.y, bounds.y, bounds.y + bounds.height - crop.height) : crop.y;
  const shiftX = x - crop.x;
  const shiftY = y - crop.y;
  const parts: string[] = [];
  parts.push(
    canX
      ? shiftX === 0
        ? "x already inside"
        : `x moved ${shiftX > 0 ? "+" : ""}${shiftX}px to stay inside`
      : `x not clamped (the ${crop.width}px window is wider than the ${bounds.width}px bound)`,
  );
  parts.push(
    canY
      ? shiftY === 0
        ? "y already inside"
        : `y moved ${shiftY > 0 ? "+" : ""}${shiftY}px to stay inside`
      : `y not clamped (the ${crop.height}px window is taller than the ${bounds.height}px bound)`,
  );
  return {
    crop: { x, y, width: crop.width, height: crop.height },
    applied: { x: canX && shiftX !== 0, y: canY && shiftY !== 0 },
    shiftPx: { x: shiftX, y: shiftY },
    note: parts.join("; "),
  };
}

/**
 * Slide a window along one axis so the given source rect is kept as fully as
 * possible. The window SIZE never changes — only where it sits inside the source;
 * ties are resolved toward the low end, so the result is deterministic.
 */
export function bestWindowFor(
  crop: Rect,
  boundedSource: { widthPx: number; heightPx: number },
  keep: Rect,
  axis: "x" | "y",
): { crop: Rect; retained: number; travelUsed: number } {
  const size = axis === "x" ? crop.width : crop.height;
  const limit = axis === "x" ? boundedSource.widthPx : boundedSource.heightPx;
  const keepSize = axis === "x" ? keep.width : keep.height;
  const keepStart = axis === "x" ? keep.x : keep.y;
  const max = Math.max(0, limit - size);
  // Deterministic candidate positions: where the policy put the window, both
  // extremes of the travel, the window aligned to the kept rect's start / end,
  // and the window centred on the kept rect.
  const candidates = new Set<number>([
    clamp(Math.round(crop[axis]), 0, max),
    0,
    max,
    clamp(Math.round(keepStart), 0, max),
    clamp(Math.round(keepStart + keepSize - size), 0, max),
    clamp(Math.round(keepStart + keepSize / 2 - size / 2), 0, max),
  ]);

  let best = crop[axis];
  let bestRatio = -1;
  for (const value of [...candidates].sort((a, b) => a - b)) {
    const pos = clamp(Math.round(value), 0, max);
    const window: Rect =
      axis === "x" ? { x: pos, y: crop.y, width: crop.width, height: crop.height } : { x: crop.x, y: pos, width: crop.width, height: crop.height };
    const ratio = retainedAreaRatio(keep, window);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = pos;
    }
  }
  const window: Rect =
    axis === "x" ? { x: best, y: crop.y, width: crop.width, height: crop.height } : { x: crop.x, y: best, width: crop.width, height: crop.height };
  return { crop: window, retained: round4(bestRatio), travelUsed: best - crop[axis] };
}

export interface KeyframeInput {
  /** Clip-relative timestamps in ms, ascending. */
  timesMs: number[];
  cropStart: Rect;
  cropEnd: Rect;
  scale: number;
  source: { widthPx: number; heightPx: number };
}

export interface FrameKeyframe {
  index: number;
  tMs: number;
  /** Position through the clip, 0..1. */
  relative: number;
  crop: Rect;
  cropNormalized: { x: number; y: number; width: number; height: number };
  scale: number;
  note: string;
}

/** Evenly spaced keyframe timestamps across a clip (always includes both ends). */
export function keyframeTimes(durationMs: number, count: number): number[] {
  const total = Math.max(0, Math.round(durationMs));
  const n = Math.max(2, Math.round(count));
  if (total <= 0) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(Math.round((total * i) / (n - 1)));
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The keyframes of a crop path: the window is linearly interpolated between the
 * start and the end window across the clip, with every intermediate window
 * rounded and kept inside the source. A hold (start === end) yields identical
 * keyframes — the honest description of "no motion data exists".
 */
export function buildKeyframes(input: KeyframeInput): FrameKeyframe[] {
  const { source } = input;
  const last = Math.max(1, input.timesMs[input.timesMs.length - 1] ?? 1);
  return input.timesMs.map((tMs, index) => {
    const t = index === input.timesMs.length - 1 ? 1 : tMs / last;
    const width = Math.min(source.widthPx, Math.max(1, Math.round(lerp(input.cropStart.width, input.cropEnd.width, t))));
    const height = Math.min(source.heightPx, Math.max(1, Math.round(lerp(input.cropStart.height, input.cropEnd.height, t))));
    const x = clamp(Math.round(lerp(input.cropStart.x, input.cropEnd.x, t)), 0, source.widthPx - width);
    const y = clamp(Math.round(lerp(input.cropStart.y, input.cropEnd.y, t)), 0, source.heightPx - height);
    const crop: Rect = { x, y, width, height };
    return {
      index,
      tMs,
      relative: Math.round(t * 10000) / 10000,
      crop,
      cropNormalized: {
        x: round4(x / source.widthPx),
        y: round4(y / source.heightPx),
        width: round4(width / source.widthPx),
        height: round4(height / source.heightPx),
      },
      scale: round4(input.scale),
      note:
        index === 0
          ? "first keyframe — window position at the clip's start"
          : index === input.timesMs.length - 1
            ? "last keyframe — window position at the clip's end"
            : "interpolated keyframe",
    };
  });
}

/** True when two crop windows are identical (a hold, not a pan). */
export function cropsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
