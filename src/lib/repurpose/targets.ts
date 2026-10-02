/**
 * Phase 5 Block 5a — PLATFORM TARGETS config (pure, client-safe).
 *
 * The output sets the repurposing engine produces: `shorts`, `reels`, `tiktoks`.
 * Each target carries a real count, a duration window in whole seconds and the
 * clip KINDS it accepts. The defaults are the plan's shape — 10 shorts / 5 reels
 * / 5 tiktoks.
 *
 * Everything here is validated and reported back verbatim: a bad count or an
 * impossible duration window is a typed 400 from ./service, never a silent
 * fallback. Nothing about a supplied config is guessed at.
 *
 * `kinds` uses the CLIP vocabulary (quote / highlight / educational), which maps
 * onto the moment kinds (hook / emotional / surprise / quote / stat /
 * informative) through CLIP_KIND_MOMENTS — the mapping is explicit so a caller
 * can see exactly why a moment qualified for a target.
 *
 * The aspect ratio each target *renders* at belongs to Block 5b (the actual
 * 16:9 → 9:16 reframing and multi-format export). This block records the target
 * and the honest gate for the render; it produces no media.
 */
import { MOMENT_KINDS, type MomentKind } from "./moments";

/* ------------------------------------------------------------------ */
/* Clip kinds                                                         */
/* ------------------------------------------------------------------ */

export const CLIP_KINDS = ["quote", "highlight", "educational"] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];

export const CLIP_KIND_LABELS: Record<ClipKind, string> = {
  quote: "Quote",
  highlight: "Highlight",
  educational: "Educational",
};

/** Which moment kinds feed which clip kind. Explicit and inspectable. */
export const CLIP_KIND_MOMENTS: Record<ClipKind, MomentKind[]> = {
  quote: ["quote"],
  highlight: ["hook", "emotional", "surprise"],
  educational: ["stat", "informative"],
};

/** The moment kind a clip kind is fed by (inverse of CLIP_KIND_MOMENTS). */
export function clipKindOfMoment(kind: MomentKind): ClipKind | null {
  for (const clipKind of CLIP_KINDS) if (CLIP_KIND_MOMENTS[clipKind].includes(kind)) return clipKind;
  return null;
}

/* ------------------------------------------------------------------ */
/* Platform targets                                                   */
/* ------------------------------------------------------------------ */

export const PLATFORM_TARGETS = ["shorts", "reels", "tiktoks"] as const;
export type PlatformTarget = (typeof PLATFORM_TARGETS)[number];

export const PLATFORM_LABELS: Record<PlatformTarget, string> = {
  shorts: "Shorts",
  reels: "Reels",
  tiktoks: "TikToks",
};

/**
 * The frame each target is delivered in. Recorded here (and reported back) so
 * Block 5b has one place to read it from; nothing is reframed or rendered in
 * this block.
 */
export const PLATFORM_ASPECT: Record<PlatformTarget, string> = {
  shorts: "9:16",
  reels: "9:16",
  tiktoks: "9:16",
};

export interface PlatformTargetSpec {
  enabled: boolean;
  /** 1..TARGET_COUNT_MAX clips for this target. */
  count: number;
  minSeconds: number;
  maxSeconds: number;
  /** Accepted clip kinds, in the order the engine prefers them. */
  kinds: ClipKind[];
}

export interface ShortsTargetConfig {
  format: string;
  version: number;
  targets: Record<PlatformTarget, PlatformTargetSpec>;
}

export const REPURPOSE_CONFIG_FORMAT = "cavis.repurpose.targets";
export const REPURPOSE_CONFIG_VERSION = 1;

/* ------------------------------------------------------------- bounds */

export const TARGET_COUNT_MIN = 1;
export const TARGET_COUNT_MAX = 50;
export const TARGET_MIN_SECONDS_MIN = 3;
export const TARGET_MIN_SECONDS_MAX = 300;
export const TARGET_MAX_SECONDS_MIN = 5;
export const TARGET_MAX_SECONDS_MAX = 600;

/** The plan's shape: 10 shorts / 5 reels / 5 tiktoks. */
export const DEFAULT_TARGETS: Record<PlatformTarget, PlatformTargetSpec> = {
  shorts: { enabled: true, count: 10, minSeconds: 20, maxSeconds: 60, kinds: ["highlight", "quote", "educational"] },
  reels: { enabled: true, count: 5, minSeconds: 15, maxSeconds: 90, kinds: ["highlight", "quote"] },
  tiktoks: { enabled: true, count: 5, minSeconds: 9, maxSeconds: 60, kinds: ["highlight", "educational", "quote"] },
};

export function defaultTargetConfig(): ShortsTargetConfig {
  return {
    format: REPURPOSE_CONFIG_FORMAT,
    version: REPURPOSE_CONFIG_VERSION,
    targets: cloneTargets(DEFAULT_TARGETS),
  };
}

function cloneTargets(targets: Record<PlatformTarget, PlatformTargetSpec>): Record<PlatformTarget, PlatformTargetSpec> {
  return Object.fromEntries(
    PLATFORM_TARGETS.map((t) => [
      t,
      { ...targets[t], kinds: [...targets[t].kinds] } satisfies PlatformTargetSpec,
    ]),
  ) as Record<PlatformTarget, PlatformTargetSpec>;
}

/* -------------------------------------------------------- validation */

export interface ConfigValid {
  ok: true;
  config: ShortsTargetConfig;
  /** Target keys the caller actually supplied. */
  supplied: PlatformTarget[];
}

export interface ConfigInvalid {
  ok: false;
  error: string;
  code: string;
  note: string;
}

export type ConfigValidation = ConfigValid | ConfigInvalid;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function invalid(error: string, code: string, note: string): ConfigInvalid {
  return { ok: false, error, code, note };
}

/**
 * Validate a caller-supplied `targets` object and merge it over the defaults.
 *
 * A partial config is allowed (each supplied target must be complete and
 * valid); an unknown target key, a bad count, an impossible duration window or
 * an unknown/empty clip-kind list is refused with a typed error naming what was
 * expected. Nothing is silently repaired.
 */
export function validateTargetConfig(raw: unknown): ConfigValidation {
  if (raw === undefined || raw === null) {
    return { ok: true, config: defaultTargetConfig(), supplied: [] };
  }
  if (!isObj(raw)) {
    return invalid("Invalid platform target config.", "invalid_config", "`targets` must be an object keyed by " + PLATFORM_TARGETS.join(", ") + ".");
  }
  const config = defaultTargetConfig();
  const supplied: PlatformTarget[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!(PLATFORM_TARGETS as readonly string[]).includes(key)) {
      return invalid("Unknown platform target.", "unknown_target", `Expected one of: ${PLATFORM_TARGETS.join(", ")} (got "${key}").`);
    }
    const target = key as PlatformTarget;
    if (!isObj(value)) {
      return invalid("Invalid platform target config.", "invalid_config", `\`targets.${target}\` must be an object.`);
    }
    const spec = { ...config.targets[target] };

    if (value.enabled !== undefined) {
      if (typeof value.enabled !== "boolean") {
        return invalid("Invalid platform target config.", "invalid_config", `\`targets.${target}.enabled\` must be a boolean.`);
      }
      spec.enabled = value.enabled;
    }

    if (value.count !== undefined) {
      const count = value.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < TARGET_COUNT_MIN || count > TARGET_COUNT_MAX) {
        return invalid(
          "Invalid clip count.",
          "invalid_count",
          `\`targets.${target}.count\` must be a whole number between ${TARGET_COUNT_MIN} and ${TARGET_COUNT_MAX} (got ${JSON.stringify(count)}).`,
        );
      }
      spec.count = count;
    }

    for (const field of ["minSeconds", "maxSeconds"] as const) {
      const value2 = value[field];
      if (value2 === undefined) continue;
      const low = field === "minSeconds" ? TARGET_MIN_SECONDS_MIN : TARGET_MAX_SECONDS_MIN;
      const high = field === "minSeconds" ? TARGET_MIN_SECONDS_MAX : TARGET_MAX_SECONDS_MAX;
      if (typeof value2 !== "number" || !Number.isInteger(value2) || value2 < low || value2 > high) {
        return invalid(
          "Invalid clip duration window.",
          "invalid_duration_window",
          `\`targets.${target}.${field}\` must be a whole number of seconds between ${low} and ${high} (got ${JSON.stringify(value2)}).`,
        );
      }
      spec[field] = value2;
    }
    if (spec.maxSeconds <= spec.minSeconds) {
      return invalid(
        "Invalid clip duration window.",
        "invalid_duration_window",
        `\`targets.${target}\` needs maxSeconds > minSeconds (got ${spec.minSeconds} → ${spec.maxSeconds}).`,
      );
    }

    if (value.kinds !== undefined) {
      const kinds = value.kinds;
      if (!Array.isArray(kinds) || kinds.length === 0) {
        return invalid(
          "Invalid clip kinds.",
          "invalid_kinds",
          `\`targets.${target}.kinds\` must be a non-empty array of: ${CLIP_KINDS.join(", ")}.`,
        );
      }
      const out: ClipKind[] = [];
      for (const kind of kinds) {
        if (typeof kind !== "string" || !(CLIP_KINDS as readonly string[]).includes(kind)) {
          return invalid(
            "Unknown clip kind.",
            "unknown_clip_kind",
            `Expected one of: ${CLIP_KINDS.join(", ")} (got ${JSON.stringify(kind)}).`,
          );
        }
        if (!out.includes(kind as ClipKind)) out.push(kind as ClipKind);
      }
      spec.kinds = out;
    }

    config.targets[target] = spec;
    supplied.push(target);
  }

  return { ok: true, config, supplied };
}

/**
 * Lenient read of a PERSISTED config (ProjectSettings.extra). A stored value
 * that no longer validates is reported as unreadable rather than half-applied —
 * the caller then falls back to the defaults and says so.
 */
export function readStoredTargetConfig(raw: unknown): { config: ShortsTargetConfig | null; unreadable: boolean } {
  if (raw === null || raw === undefined) return { config: null, unreadable: false };
  if (!isObj(raw) || raw.format !== REPURPOSE_CONFIG_FORMAT) return { config: null, unreadable: true };
  const result = validateTargetConfig(raw.targets);
  if (!result.ok) return { config: null, unreadable: true };
  return { config: result.config, unreadable: false };
}

/** Serialisable view of a config (what the response reports back to the client). */
export function targetConfigView(config: ShortsTargetConfig): Record<string, unknown> {
  return {
    format: config.format,
    version: config.version,
    targets: Object.fromEntries(
      PLATFORM_TARGETS.map((t) => [
        t,
        {
          enabled: config.targets[t].enabled,
          count: config.targets[t].count,
          minSeconds: config.targets[t].minSeconds,
          maxSeconds: config.targets[t].maxSeconds,
          kinds: [...config.targets[t].kinds],
          label: PLATFORM_LABELS[t],
          aspect: PLATFORM_ASPECT[t],
          totalSecondsWindow: `${config.targets[t].minSeconds}-${config.targets[t].maxSeconds}s`,
        },
      ]),
    ),
  };
}

/** True when two configs describe the same output sets (order-insensitive kinds comparison not needed: kinds are ordered). */
export function targetConfigsEqual(a: ShortsTargetConfig, b: ShortsTargetConfig): boolean {
  for (const t of PLATFORM_TARGETS) {
    const x = a.targets[t];
    const y = b.targets[t];
    if (x.enabled !== y.enabled || x.count !== y.count) return false;
    if (x.minSeconds !== y.minSeconds || x.maxSeconds !== y.maxSeconds) return false;
    if (x.kinds.length !== y.kinds.length) return false;
    for (let i = 0; i < x.kinds.length; i += 1) if (x.kinds[i] !== y.kinds[i]) return false;
  }
  return true;
}

/** The moment kinds a target will consider, derived from its clip kinds. */
export function momentsForTarget(spec: PlatformTargetSpec): MomentKind[] {
  const out: MomentKind[] = [];
  for (const clipKind of spec.kinds) {
    for (const moment of CLIP_KIND_MOMENTS[clipKind]) {
      if (!out.includes(moment)) out.push(moment);
    }
  }
  // Any moment kind not fed by a clip kind can never be selected — report that
  // honestly instead of pretending it is covered.
  return out.filter((m) => (MOMENT_KINDS as readonly MomentKind[]).includes(m));
}
