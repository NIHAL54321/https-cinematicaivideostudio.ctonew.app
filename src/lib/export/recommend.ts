/**
 * THE SMART RECOMMENDATION — computed from the project's own measured facts
 * (Phase 8, block 2a).
 *
 * WHAT THIS IS
 * A function that reads facts this app can actually measure — the project's
 * scenes and their declared durations, its target aspect ratio, how many scenes
 * it has, the pixel dimensions its own Asset rows carry, and the platform the
 * owner picked — and names ONE preset from the catalogue, printing the reading
 * and the reason for every step.
 *
 * WHAT IT IS NOT
 * It is not a prediction and not a promise. There is no "best", no "optimal for
 * views", no viewer estimate, no search-volume-style number and no ranking
 * claim anywhere in this file: none of those can be measured here, so none is
 * invented. It recommends a DELIVERY SPECIFICATION — the frame, codec, bitrate
 * and audio a render would be prepared with — and says why.
 *
 * WHEN A FACT IS MISSING
 * Some of what it would like to know may not exist: a project may have no scene
 * with a declared duration, no target aspect ratio, or no asset row carrying
 * pixel dimensions. In that case the recommendation is returned on a PARTIAL
 * BASIS (`basis.complete: false`), naming each missing fact and what it did
 * instead. It never fills the gap with a guess and calls it a measurement.
 *
 * Pure and client-safe: it takes a measurement object and returns a view.
 */
import { findExportPreset, type ExportPresetId } from "./presets";
import { findPublishTarget, isPublishTargetId } from "./readiness";

/** Every fact the recommendation reads, with where it was measured. */
export interface ProjectMeasurement {
  projectId: string;
  title: string;
  /** The platform the owner picked, if any (a publish target id). */
  targetPlatform: string | null;
  /** Sum of the project's Scene.durationSeconds; null when no scene declares one. */
  durationSeconds: number | null;
  /** Project.targetDurationSeconds — the length the owner asked for. */
  targetDurationSeconds: number | null;
  sceneCount: number;
  /** The project's own aspect, from Project.targetAspectRatio or ProjectSettings. */
  aspect: "16:9" | "9:16" | "1:1" | "4:5" | null;
  /** Where the aspect reading came from, in words. */
  aspectSource: string;
  assetCount: number;
  /** The largest width any of the project's assets declares; null when none does. */
  assetMaxWidthPx: number | null;
  assetMaxHeightPx: number | null;
  /** ISO timestamp of the read. */
  measuredAt: string;
}

export interface ReasonStep {
  /** The fact, as measured. */
  fact: string;
  /** What it read. */
  reading: string;
  /** Why that reading led where it did. */
  why: string;
}

export interface MissingFact {
  fact: string;
  why: string;
  /** What the recommendation did instead — never an invented value. */
  instead: string;
}

export interface Recommendation {
  presetId: ExportPresetId;
  presetLabel: string;
  /** One line: the preset, and that it is a specification, not a file. */
  headline: string;
  reasons: ReasonStep[];
  basis: {
    /** True only when every fact it wanted was measurable. */
    complete: boolean;
    /** The sentence the surface prints about the basis. */
    statement: string;
    measured: Array<{ fact: string; value: string }>;
    missing: MissingFact[];
  };
  /** The things this recommendation does NOT claim. Printed with it. */
  notClaimed: string[];
  producedOnThisBuild: false;
}

/** What this function refuses to say, whatever the facts are. */
export const RECOMMENDATION_NOT_CLAIMED: readonly string[] = [
  "It does not say a preset is best, optimal or recommended by any platform: no platform publishes such a verdict for this app to read.",
  "It does not predict views, watch time, audience reach, ranking or discovery. No number about how many people will see this video exists here, because none can be measured.",
  "It does not estimate search volume, keyword difficulty, competition or traffic for the topic.",
  "It does not promise that a render will succeed: the encode stage is blocked on this build and names the missing encoder.",
];

const ASPECT_PRESET: Record<NonNullable<ProjectMeasurement["aspect"]>, ExportPresetId> = {
  "9:16": "youtube-shorts",
  "1:1": "square-1080",
  "4:5": "portrait-4x5",
  "16:9": "youtube-1080p",
};

function fmtSeconds(n: number): string {
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m > 0 ? `${m} min ${s} s (${n} s)` : `${s} s`;
}

/**
 * The recommendation. Deterministic: the same measurement always yields the same
 * preset and the same reasons, in the same order.
 */
export function recommendPreset(m: ProjectMeasurement): Recommendation {
  const reasons: ReasonStep[] = [];
  const missing: MissingFact[] = [];
  const measured: Array<{ fact: string; value: string }> = [];

  /* 1 — the platform, when the owner named one. */
  let presetId: ExportPresetId | null = null;
  /** True when an explicit platform choice decided the preset — it is not overruled later. */
  let presetFromPlatform = false;
  if (m.targetPlatform && isPublishTargetId(m.targetPlatform)) {
    const target = findPublishTarget(m.targetPlatform);
    const preferred = target?.preferredPresetId;
    if (preferred && findExportPreset(preferred)) {
      presetId = preferred as ExportPresetId;
      presetFromPlatform = true;
      reasons.push({
        fact: `target platform: ${target!.label}`,
        reading: `${target!.label} declares "${preferred}" as the preset it delivers with`,
        why:
          `The platform was chosen explicitly, and the readiness catalogue names the delivery preset for it. The ` +
          `recommendation takes that preset rather than overruling a choice the owner made.`,
      });
      measured.push({ fact: "target platform", value: `${target!.label} (${m.targetPlatform})` });
    } else {
      missing.push({
        fact: `a delivery preset for ${target?.label ?? m.targetPlatform}`,
        why: "the readiness catalogue names no preferred preset for that target",
        instead: "the recommendation fell back to the project's own aspect ratio",
      });
    }
  } else if (m.targetPlatform) {
    missing.push({
      fact: `the platform "${m.targetPlatform}"`,
      why: "it is not a publish target this app declares",
      instead: "the recommendation ignored it and used the project's own aspect ratio",
    });
  } else {
    // No platform chosen is not a MISSING fact: the recommendation does not need
    // one — the project's own aspect and source resolution decide the frame. It
    // is recorded as a reading so a reader can see it was considered.
    reasons.push({
      fact: "target platform",
      reading: "none chosen for this project",
      why:
        "With no platform chosen, the project's own aspect ratio and source resolution decide the delivery frame. That " +
        "is a complete basis: nothing here needs a platform to be answerable.",
    });
  }

  /* 2 — aspect, when it is known. */
  if (m.aspect) {
    measured.push({ fact: "aspect", value: `${m.aspect} (${m.aspectSource})` });
    reasons.push({
      fact: "aspect ratio",
      reading: `${m.aspect} — read from ${m.aspectSource}`,
      why:
        m.aspect === "16:9"
          ? "A landscape project delivers in a 16:9 frame; the choice left is how many lines to deliver, which the source resolution decides."
          : `A ${m.aspect} project needs the ${m.aspect} delivery frame; the presets that deliver that frame are ${ASPECT_PRESET[m.aspect]}.`,
    });
    if (!presetId) presetId = ASPECT_PRESET[m.aspect];
  } else {
    missing.push({
      fact: "the project's aspect ratio",
      why: "neither the project's target aspect ratio nor its settings declares one",
      instead: "the recommendation assumed the 16:9 long-form frame — the app's declared default — and says so here",
    });
    reasons.push({
      fact: "aspect ratio",
      reading: "nothing on this project declares one; the app's own 16:9 default is used",
      why:
        "The default is the app's declared long-form frame, not a measurement of this project — which is why this " +
        "recommendation is marked as resting on a partial basis.",
    });
    presetId = presetId ?? "youtube-1080p";
  }

  /* 3 — source resolution: the one fact that decides 2160p versus 1080p. */
  const landscape = (m.aspect ?? "16:9") === "16:9";
  // An explicit platform choice is not overruled by the resolution rule: the
  // platform's own preset already names the frame, and second-guessing it would
  // be the app deciding against a decision the owner made.
  if (landscape && !presetFromPlatform) {
    if (m.assetMaxHeightPx !== null) {
      measured.push({ fact: "largest source height", value: `${m.assetMaxHeightPx} px across ${m.assetCount} asset(s)` });
      if (m.assetMaxHeightPx >= 2160) {
        presetId = "youtube-2160p";
        reasons.push({
          fact: "source resolution",
          reading: `the tallest asset the project owns is ${m.assetMaxWidthPx}×${m.assetMaxHeightPx}`,
          why:
            "The source already carries at least 2160 lines, so a 4K delivery is not an upscale — it is the frame the " +
            "footage already fills. That is the only reason 2160p is chosen over 1080p.",
        });
      } else {
        presetId = "youtube-1080p";
        reasons.push({
          fact: "source resolution",
          reading: `the tallest asset the project owns is ${m.assetMaxWidthPx}×${m.assetMaxHeightPx}`,
          why:
            "The source is below 2160 lines, so a 4K master would be an upscale of pixels that do not exist. 1080p " +
            "delivers at the frame the footage already fills; the framing plan prints the factor for any clip that still " +
            "needs scaling.",
        });
      }
    } else {
      presetId = "youtube-1080p";
      missing.push({
        fact: "the source resolution",
        why:
          m.assetCount === 0
            ? "the project has no Asset rows at all"
            : `none of the project's ${m.assetCount} asset(s) carries pixel dimensions`,
        instead:
          "the recommendation cannot tell whether 2160p would be a real 4K delivery or a 2× upscale, so it did NOT " +
          "choose 2160p. It chose 1080p — the frame that needs no upscale from an unknown source — and marks this " +
          "recommendation as being on a partial basis.",
      });
    }
  }

  /* 4 — duration: printed, and checked against the target's own limit. */
  if (m.durationSeconds !== null) {
    measured.push({ fact: "duration (sum of declared scene durations)", value: fmtSeconds(m.durationSeconds) });
    const target = m.targetPlatform && isPublishTargetId(m.targetPlatform) ? findPublishTarget(m.targetPlatform) : null;
    if (target) {
      const over = m.durationSeconds > target.duration.maxSeconds;
      reasons.push({
        fact: "duration",
        reading: `${fmtSeconds(m.durationSeconds)} across ${m.sceneCount} scene(s)`,
        why: over
          ? `${target.label}'s published upload limit is ${fmtSeconds(target.duration.maxSeconds)}, and this project is ` +
            `longer than that. The preset is still the right delivery frame, but the length is a real problem to fix ` +
            `before this target — the readiness report carries it as its own check.`
          : `${target.label}'s published upload limit is ${fmtSeconds(target.duration.maxSeconds)}; this project is ` +
            `inside it, so the length does not change the recommendation.`,
      });
    } else {
      reasons.push({
        fact: "duration",
        reading: `${fmtSeconds(m.durationSeconds)} across ${m.sceneCount} scene(s)`,
        why:
          "The duration does not change which frame or codec to deliver — it changes the size estimate and the upload " +
          "time, both of which are printed beside the preset.",
      });
    }
  } else {
    missing.push({
      fact: "the duration",
      why: "no scene on this project declares a duration, so the total is 0 s rather than a measurement",
      instead: "the recommendation does not use duration at all, and the size estimate is withheld until one exists",
    });
  }

  /* 5 — scene count: a sanity reading, not a decision input. */
  if (m.sceneCount > 0) {
    measured.push({ fact: "scenes", value: `${m.sceneCount}` });
    reasons.push({
      fact: "scenes",
      reading: `${m.sceneCount} scene(s) on the project`,
      why:
        "The scene count changes nothing about the delivery specification — a frame and a codec do not depend on how many " +
        "cuts the timeline has. It is printed because a reader should be able to see what was measured.",
    });
  } else {
    missing.push({
      fact: "scenes",
      why: "the project has no Scene rows, so there is nothing to render",
      instead: "the recommendation is about the delivery frame only; the render itself would be blocked on the scene count",
    });
  }

  const chosen = findExportPreset(presetId ?? "youtube-1080p");
  const resolvedId = (chosen?.id ?? "youtube-1080p") as ExportPresetId;
  const resolved = findExportPreset(resolvedId)!;
  const complete = missing.length === 0;

  return {
    presetId: resolvedId,
    presetLabel: resolved.label,
    headline:
      `Recommended: ${resolved.label} — ${resolved.widthPx}×${resolved.heightPx}, ${resolved.video.codec}, ` +
      `${resolved.video.rateControl.targetVideoBitrateKbps} kbps video, ${resolved.audio.audioBitrateKbps} kbps audio. ` +
      "This is a delivery specification the app can compute; no file is produced on this build.",
    reasons,
    basis: {
      complete,
      statement: complete
        ? "Every fact this recommendation wanted was measurable on this project, so it rests on measurement alone."
        : `This recommendation is on a PARTIAL BASIS: ${missing.length} fact${missing.length === 1 ? " was" : "s were"} not ` +
          `measurable (${missing.map((x) => x.fact).join("; ")}). Nothing was invented to fill the gap — what the ` +
          "recommendation did instead is stated for each one.",
      measured,
      missing,
    },
    notClaimed: [...RECOMMENDATION_NOT_CLAIMED],
    producedOnThisBuild: false,
  };
}

/** The recommendation as the API and the surface return it, with its input. */
export function recommendationView(m: ProjectMeasurement, r: Recommendation = recommendPreset(m)): Record<string, unknown> {
  return {
    project: { id: m.projectId, title: m.title },
    measurement: { ...m },
    recommendation: {
      presetId: r.presetId,
      presetLabel: r.presetLabel,
      headline: r.headline,
      reasons: r.reasons.map((x) => ({ ...x })),
      basis: {
        complete: r.basis.complete,
        statement: r.basis.statement,
        measured: r.basis.measured.map((x) => ({ ...x })),
        missing: r.basis.missing.map((x) => ({ ...x })),
      },
      notClaimed: [...r.notClaimed],
      producedOnThisBuild: false,
    },
  };
}
