/**
 * Phase 6 Block 1 — ESTIMATED SIZE ARITHMETIC (pure, client-safe).
 *
 * The estimate is a formula, not a produced file:
 *
 *   bits  = (video bitrate + audio bitrate) × duration
 *   bytes = bits ÷ 8
 *
 * with the bitrate in kbps (1000 bits per kilobit per second), the duration in
 * seconds and the result in bytes (8 bits per byte). Every unit is stated in the
 * returned object and in the substituted formula string, so a reader can check
 * the arithmetic by hand.
 *
 * WHAT IS NOT IN THE ESTIMATE (stated, never silently omitted):
 *   - container / muxing overhead,
 *   - any subtitle or metadata track,
 *   - any thumbnail or sidecar file,
 *   - the difference between an average target bitrate and the real, content-
 *     dependent bitrate a CRF encoder produces.
 *
 * The result is always an ESTIMATE: `estimate: true`, `produced: false`. There is
 * no code path in this module that writes a byte anywhere.
 */

/* ------------------------------------------------------------------ */
/* Units + bounds                                                      */
/* ------------------------------------------------------------------ */

/** Bitrate unit used by every preset and by this arithmetic. */
export const BITRATE_UNIT = "kbps (1000 bits per second)";
/** Duration unit used by every preset and by this arithmetic. */
export const DURATION_UNIT = "seconds";
/** Size unit the formula produces, before formatting. */
export const SIZE_UNIT = "bytes (8 bits per byte)";

export const BITS_PER_KILOBIT = 1000;
export const BITS_PER_BYTE = 8;
export const BYTES_PER_MEBIBYTE = 1024 * 1024;
export const BYTES_PER_GIBIBYTE = 1024 * 1024 * 1024;

/**
 * Long-form ceiling: 120 minutes, the maximum length the business plan promises
 * ("long-form up to 120 min"). A longer duration is refused with a typed 400
 * rather than quietly estimated.
 */
export const MAX_EXPORT_DURATION_SECONDS = 120 * 60;

/** The visible formula, in the units above. */
export const SIZE_FORMULA = "size = (video bitrate + audio bitrate) × duration ÷ 8";
export const SIZE_FORMULA_UNITS =
  "video bitrate and audio bitrate in kbps (1000 bits/s), duration in seconds, size in bytes (8 bits/byte)";

export const SIZE_EXCLUDES = [
  "container / muxing overhead (mp4 boxes, index, metadata)",
  "any subtitle or timed-text track",
  "any thumbnail or sidecar file",
  "the gap between an average target bitrate and a real CRF encoder's content-dependent output",
];

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type SizeErrorCode =
  | "invalid_video_bitrate"
  | "invalid_audio_bitrate"
  | "invalid_duration"
  | "duration_out_of_range";

export class SizeError extends Error {
  readonly code: SizeErrorCode;
  constructor(code: SizeErrorCode, message: string) {
    super(message);
    this.name = "SizeError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** "3.75 GB" / "742.1 MB" / "512 B" — binary units, explicitly labelled. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "n/a";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < BYTES_PER_MEBIBYTE) return `${round2(bytes / 1024)} KiB`;
  if (bytes < BYTES_PER_GIBIBYTE) return `${round2(bytes / BYTES_PER_MEBIBYTE)} MiB`;
  return `${round2(bytes / BYTES_PER_GIBIBYTE)} GiB`;
}

/** "2h 00m 00s" from whole seconds (the long-form duration display). */
export function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "n/a";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}

/* ------------------------------------------------------------------ */
/* The estimate                                                        */
/* ------------------------------------------------------------------ */

export interface SizeInput {
  /** Video bitrate in kbps (the preset's planning target). */
  videoBitrateKbps: number;
  /** Audio bitrate in kbps. */
  audioBitrateKbps: number;
  /** Duration in seconds. */
  durationSeconds: number;
}

export interface SizeEstimate {
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  totalBitrateKbps: number;
  durationSeconds: number;
  durationMinutes: number;
  durationHuman: string;
  /** Raw bit count before the ÷8. */
  bits: number;
  bytes: number;
  kilobytes: number;
  megabytes: number;
  mebibytes: number;
  gibibytes: number;
  human: string;
  /** The formula, and the same formula with this input's numbers substituted. */
  formula: string;
  formulaUnits: string;
  substituted: string;
  units: { bitrate: string; duration: string; size: string };
  /** What the estimate leaves out. */
  excludes: string[];
  /** This is an ESTIMATE. No file was produced. */
  estimate: true;
  produced: false;
}

function checkBitrate(value: unknown, code: SizeErrorCode, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SizeError(code, `${label} must be a positive, finite number of kbps (got ${JSON.stringify(value)}).`);
  }
  return value;
}

/**
 * The size arithmetic. Throws `SizeError` (a typed code the service maps to a
 * 400) for anything that is not a positive finite bitrate or a duration inside
 * 0 < duration ≤ MAX_EXPORT_DURATION_SECONDS.
 */
export function estimateSize(input: SizeInput): SizeEstimate {
  const videoBitrateKbps = checkBitrate(input.videoBitrateKbps, "invalid_video_bitrate", "videoBitrateKbps");
  const audioBitrateKbps = checkBitrate(input.audioBitrateKbps, "invalid_audio_bitrate", "audioBitrateKbps");
  const durationSeconds = input.durationSeconds;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new SizeError("invalid_duration", `durationSeconds must be a positive, finite number of seconds (got ${JSON.stringify(durationSeconds)}).`);
  }
  if (durationSeconds > MAX_EXPORT_DURATION_SECONDS) {
    throw new SizeError(
      "duration_out_of_range",
      `durationSeconds must not exceed ${MAX_EXPORT_DURATION_SECONDS} s (120 minutes) — got ${round3(durationSeconds)} s.`,
    );
  }

  const totalBitrateKbps = videoBitrateKbps + audioBitrateKbps;
  const bits = totalBitrateKbps * BITS_PER_KILOBIT * durationSeconds;
  const bytes = bits / BITS_PER_BYTE;

  return {
    videoBitrateKbps,
    audioBitrateKbps,
    totalBitrateKbps,
    durationSeconds,
    durationMinutes: round3(durationSeconds / 60),
    durationHuman: humanDuration(durationSeconds),
    bits,
    bytes,
    kilobytes: round3(bytes / 1000),
    megabytes: round3(bytes / 1_000_000),
    mebibytes: round3(bytes / BYTES_PER_MEBIBYTE),
    gibibytes: round3(bytes / BYTES_PER_GIBIBYTE),
    human: humanBytes(bytes),
    formula: SIZE_FORMULA,
    formulaUnits: SIZE_FORMULA_UNITS,
    substituted:
      `(${videoBitrateKbps} kbps + ${audioBitrateKbps} kbps) × ${durationSeconds} s ÷ 8 = ` +
      `${totalBitrateKbps} kbps × ${durationSeconds} s × 1000 ÷ 8 = ${bytes} bytes (${humanBytes(bytes)})`,
    units: { bitrate: BITRATE_UNIT, duration: DURATION_UNIT, size: SIZE_UNIT },
    excludes: [...SIZE_EXCLUDES],
    estimate: true,
    produced: false,
  };
}

/** True when the input is inside the accepted bounds — the service's gate check. */
export function isValidSizeInput(input: {
  videoBitrateKbps?: unknown;
  audioBitrateKbps?: unknown;
  durationSeconds?: unknown;
}): boolean {
  try {
    estimateSize({
      videoBitrateKbps: input.videoBitrateKbps as number,
      audioBitrateKbps: input.audioBitrateKbps as number,
      durationSeconds: input.durationSeconds as number,
    });
    return true;
  } catch {
    return false;
  }
}
