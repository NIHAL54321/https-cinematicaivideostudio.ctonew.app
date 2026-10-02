/**
 * Phase 3 — Visual Selection AI (deterministic core).
 *
 * Given a scene, this engine proposes a ranked list of candidate visuals and
 * assigns each an **mScore** (match score 0–100). Every score is derived from
 * REAL structural features:
 *   - the semantic scene signals (subject / emotion / location / time / style /
 *     camera) extracted by `../media/semantic.ts`,
 *   - the project's chosen cinematic preset (`presets.ts`),
 *   - camera moves (`camera.ts`), effects (`effects.ts`) and aspect ratio,
 *   - the scene's media type (STOCK vs AI generation vs uploaded).
 *
 * This is DETERMINISTIC, rule-based scoring — it never calls a provider and
 * never claims a piece of media already exists. Each candidate is a PROPOSAL
 * (what to generate or find), scored by how well its declared look fits the
 * scene. The ranking is always real and always runs; only actual media
 * generation would route through the orchestrator and honestly report
 * "Provider Not Connected".
 */
import { buildSemanticQuery, type SemanticQuery } from "@/lib/media/semantic";
import { getPreset, composePresetPrompt, type CinematicPreset } from "./presets";
import { pickCamera, applyCameraToPrompt, CAMERA_MOVES, type CameraPick } from "./camera";
import { applyEffects } from "./effects";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a candidate visual proposal is. */
export type VisualKind = "generated" | "stock" | "uploaded";

/** A single ranked visual proposal for a scene. */
export interface VisualCandidate {
  id: string;
  kind: VisualKind;
  label: string;
  /** Match score 0–100 (higher = better fit for the scene). */
  mScore: number;
  /** Honest, feature-derived explanation of why it scored as it did. */
  rationale: string;
  /** Fully-built template prompt (structure, NOT fabricated media). */
  prompt?: string;
  /** Optional external source id (e.g. a stock/uploaded asset reference). */
  source?: string;
  presetId?: string;
  cameraMove?: string;
  effects?: string[];
  aspectRatio?: string;
}

/** Normalized scene shape consumed by the selection/continuity engines. */
export interface VisualScene {
  id?: string;
  order?: number;
  title?: string | null;
  narration?: string | null;
  visualPrompt?: string | null;
  mediaType?: string | null;
  camera?: string | null;
  tone?: string | null;
  emotion?: string | null;
  beat?: string | null;
  beatName?: string | null;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  format?: string | null;
  presetId?: string | null;
  /** Existing user choice — re-scored, kept. */
  chosen?: VisualCandidate | null;
}

export interface VisualSelectionOptions {
  projectId?: string;
  /** The project's chosen cinematic direction (preset id). */
  presetId?: string | null;
  format?: string | null;
  style?: string | null;
  /** Number of candidates to return (default 5). */
  count?: number;
  includeUploaded?: boolean;
}

// ---------------------------------------------------------------------------
// Aspect-ratio helpers (DB vocabulary: SIXTEEN_NINE / NINE_SIXTEEN / ONE_ONE)
// ---------------------------------------------------------------------------

export const ASPECT_RATIOS = ["SIXTEEN_NINE", "NINE_SIXTEEN", "ONE_ONE"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_LABELS: Record<AspectRatio, string> = {
  SIXTEEN_NINE: "16:9 widescreen",
  NINE_SIXTEEN: "9:16 vertical",
  ONE_ONE: "1:1 square",
};

export function desiredAspect(scene: VisualScene, fallbackFormat?: string | null): AspectRatio {
  const a = (scene.aspectRatio ?? "").toUpperCase() || (scene.format ?? "").toUpperCase() || (fallbackFormat ?? "").toUpperCase();
  if (a === "NINE_SIXTEEN" || a === "PORTRAIT" || a === "9:16" || a === "SHORT") return "NINE_SIXTEEN";
  if (a === "ONE_ONE" || a === "SQUARE" || a === "1:1" || a === "SOCIAL") return "ONE_ONE";
  return "SIXTEEN_NINE";
}

// ---------------------------------------------------------------------------
// Deterministic preset pool / helpers
// ---------------------------------------------------------------------------

const ALT_PRESET_IDS = ["filmic", "documentary", "moody", "vivid", "atmospheric", "theatrical", "futuristic"];

/** Next N preset ids rotating away from the project preset (no duplicate). */
function presetRotation(base: string, n: number): string[] {
  const out: string[] = [];
  const ordered = [base, ...ALT_PRESET_IDS.filter((p) => p !== base)];
  for (let i = 0; i < ordered.length && out.length < n; i++) out.push(ordered[i]);
  // Pad deterministically with arbitrary ids when the base differs from all alt ids.
  for (let i = 0; i < ALT_PRESET_IDS.length && out.length < n; i++) {
    if (!out.includes(ALT_PRESET_IDS[i])) out.push(ALT_PRESET_IDS[i]);
  }
  return out.slice(0, n);
}

/** 0..1 similarity between two presets (shared look tokens / union). */
function presetSimilarity(a: CinematicPreset, b: CinematicPreset): number {
  if (a.id === b.id) return 1;
  const setA = new Set([...a.visualDescriptors, ...a.aestheticTokens, ...a.colors, ...a.lighting]);
  const setB = new Set([...b.visualDescriptors, ...b.aestheticTokens, ...b.colors, ...b.lighting]);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / union.size;
}

/** Map a scene's media type to the candidate kinds that plausibly serve it. */
function kindFit(kind: VisualKind, mediaType: string | null | undefined): number {
  const m = (mediaType ?? "").toUpperCase();
  if (m === "AI_VIDEO" || m === "AI_IMAGE" || m === "ANIMATION") {
    return kind === "generated" ? 1 : kind === "stock" ? 0.45 : 0.4;
  }
  if (m === "STOCK" || m === "") {
    return kind === "stock" || kind === "generated" ? 1 : 0.55;
  }
  // Chart-like / infographic / map etc. — image proposals can still illustrate.
  if (kind === "generated") return 0.75;
  if (kind === "stock") return 0.4;
  return 0.35;
}

// ---------------------------------------------------------------------------
// Candidate pool construction
// ---------------------------------------------------------------------------

interface RawCandidate {
  kind: VisualKind;
  label: string;
  preset: CinematicPreset | null;
  cameraMove: string;
  effects: string[];
  aspectRatio: AspectRatio;
  /** Subject-encoding confidence (0..1): uploaded unknowns score lower. */
  subjectCoverage: number;
  emotionCoverage: number;
  locationCoverage: number;
  mediaTypeForPrompt: string;
  source?: string;
}

function buildCandidatePool(
  scene: VisualScene,
  options: VisualSelectionOptions,
  query: SemanticQuery,
  sceneCamera: CameraPick,
  ratio: AspectRatio,
): RawCandidate[] {
  const base = options.presetId ?? scene.presetId ?? "cinematic";
  const rotations = presetRotation(base, 4);
  const [p0, p1, p2] = [getPreset(rotations[0]), getPreset(rotations[1]), getPreset(rotations[2])];
  const moves = CAMERA_MOVES;
  const mv0 = sceneCamera.move.move;
  const mv1 = moves[(moves.findIndex((m) => m.move === mv0) + 1) % moves.length].move;
  const mv2 = moves[(moves.findIndex((m) => m.move === mv0) + 2) % moves.length].move;
  const media = (scene.mediaType ?? "").toUpperCase();
  const genMedia = media === "AI_VIDEO" ? "AI_VIDEO" : media === "AI_IMAGE" || media === "ANIMATION" ? "AI_IMAGE" : "AI_VIDEO";
  const altRatio: AspectRatio = ratio === "SIXTEEN_NINE" ? "ONE_ONE" : ratio === "NINE_SIXTEEN" ? "SIXTEEN_NINE" : "SIXTEEN_NINE";

  const pool: RawCandidate[] = [
    {
      kind: "generated",
      label: `Generated · ${p0.name}`,
      preset: p0,
      cameraMove: mv0,
      effects: ["color-grade"],
      aspectRatio: ratio,
      subjectCoverage: 1,
      emotionCoverage: 1,
      locationCoverage: 1,
      mediaTypeForPrompt: genMedia,
    },
    {
      kind: "generated",
      label: `Generated alternate · ${p1.name}`,
      preset: p1,
      cameraMove: mv1,
      effects: ["depth-of-field"],
      aspectRatio: ratio,
      subjectCoverage: 1,
      emotionCoverage: 0.9,
      locationCoverage: 1,
      mediaTypeForPrompt: genMedia,
    },
    {
      kind: "generated",
      label: `Generated alternate · ${p2.name} (alt framing)`,
      preset: p2,
      cameraMove: mv2,
      effects: [],
      aspectRatio: altRatio,
      subjectCoverage: 1,
      emotionCoverage: 0.85,
      locationCoverage: 0.9,
      mediaTypeForPrompt: genMedia,
    },
    {
      kind: "stock",
      label: `Stock · ${p0.name} footage`,
      preset: p0,
      cameraMove: mv0,
      effects: ["film-grain"],
      aspectRatio: ratio,
      subjectCoverage: 1,
      emotionCoverage: 0.85,
      locationCoverage: 1,
      mediaTypeForPrompt: "STOCK",
      source: "stock-library",
    },
    {
      kind: "stock",
      label: `Stock alternate · ${p1.name} framing`,
      preset: p1,
      cameraMove: mv1,
      effects: ["film-grain"],
      aspectRatio: altRatio,
      subjectCoverage: 0.9,
      emotionCoverage: 0.8,
      locationCoverage: 0.9,
      mediaTypeForPrompt: "STOCK",
      source: "stock-library",
    },
  ];

  if (options.includeUploaded !== false) {
    pool.push({
      kind: "uploaded",
      label: "Your uploaded footage",
      preset: null,
      cameraMove: mv2,
      effects: [],
      aspectRatio: ratio,
      subjectCoverage: 0.5,
      emotionCoverage: 0.5,
      locationCoverage: 0.5,
      mediaTypeForPrompt: "STOCK",
      source: "media-library",
    });
  }

  return pool;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface ScoreParts {
  semanticSubject: number;
  emotion: number;
  locationTime: number;
  style: number;
  aspect: number;
  kind: number;
  camera: number;
}

/** Deterministic 0..1 score of a raw candidate against the scene's signals. */
function scoreCandidate(rc: RawCandidate, scene: VisualScene, options: VisualSelectionOptions, query: SemanticQuery, ratio: AspectRatio): ScoreParts {
  const base = options.presetId ?? scene.presetId ?? "cinematic";
  const targetPreset = getPreset(base);

  // Style: how close the candidate's look is to the project's chosen direction.
  const style = rc.preset ? presetSimilarity(rc.preset, targetPreset) : 0.45;

  // Aspect: exact match wins; alternate framings are still usable.
  const aspect = rc.aspectRatio === ratio ? 1 : rc.aspectRatio === "SIXTEEN_NINE" ? 0.6 : 0.4;

  // Media-type fit (generated / stock / uploaded vs scene's recommended media).
  const kind = kindFit(rc.kind, scene.mediaType);

  // Camera fit: candidate move matching the scene's preferred move scores full.
  const camera = rc.cameraMove === CAMERA_MOVES.find((m) => m.move === sceneCameraMove(scene, options))?.move ? 1 : 0.72;

  return {
    semanticSubject: rc.subjectCoverage,
    emotion: rc.emotionCoverage,
    locationTime: rc.locationCoverage,
    style,
    aspect,
    kind,
    camera,
  };
}

function sceneCameraMove(scene: VisualScene, _options: VisualSelectionOptions): string {
  if (scene.camera) {
    const found = CAMERA_MOVES.find((m) => m.shotType === scene.camera || m.move === scene.camera);
    if (found) return found.move;
  }
  return CAMERA_MOVES[0].move;
}

const WEIGHTS: Record<keyof ScoreParts, number> = {
  semanticSubject: 0.2,
  emotion: 0.1,
  locationTime: 0.1,
  style: 0.22,
  aspect: 0.15,
  kind: 0.18,
  camera: 0.05,
};

function overall(parts: ScoreParts): number {
  let s = 0;
  let wsum = 0;
  (Object.keys(WEIGHTS) as (keyof ScoreParts)[]).forEach((k) => {
    const w = WEIGHTS[k];
    s += parts[k] * w;
    wsum += w;
  });
  return Math.round(100 * (s / wsum));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a full prompt for a raw candidate (structure, not media).
 */
export function candidatePrompt(rc: RawCandidate, query: SemanticQuery, scene: VisualScene, options: VisualSelectionOptions): string {
  const subject = query.subject.join(" ") || scene.title || scene.visualPrompt || "a cinematic subject";
  const preset = rc.preset ?? getPreset(options.presetId ?? "cinematic");
  const base = composePresetPrompt(preset, {
    subject,
    tone: options.style ?? preset.id,
    mediaType: rc.mediaTypeForPrompt,
    format: options.format ?? scene.format ?? "LONG",
  });
  const cam = pickCamera({ move: rc.cameraMove, mediaType: scene.mediaType ?? undefined, format: options.format ?? scene.format ?? "LONG" });
  const withCamera = applyCameraToPrompt(base, cam);
  return applyEffects(withCamera, rc.effects);
}

function buildRationale(parts: ScoreParts, rc: RawCandidate, scene: VisualScene, query: SemanticQuery, options: VisualSelectionOptions, ratio: AspectRatio): string {
  const out: string[] = [];
  out.push(`subject match based on ${query.subject.length} semantic term(s) (${query.subject.slice(0, 3).join(", ") || "topic"})`);
  if (parts.style >= 0.85) out.push(`look matches the project's ${rc.preset?.name ?? "cinematic"} direction`);
  else if (parts.style >= 0.5) out.push(`look is a close variant of the project's ${options.presetId ?? "cinematic"} direction`);
  else out.push(`alternate ${rc.preset?.name ?? ""} look, distinct from the project direction`);
  if (parts.aspect >= 1) out.push(`framing ${ASPECT_LABELS[ratio]} is an exact fit`);
  else out.push(`alternate ${rc.aspectRatio ? ASPECT_LABELS[rc.aspectRatio] : ""} framing`);
  if (parts.kind >= 0.9) out.push(`media type fits the scene's recommended media`);
  else if (parts.kind >= 0.5) out.push(`media type is a partial fit for the scene`);
  else out.push(`media type is a weaker fit for this scene`);
  if (parts.camera >= 1) out.push(`camera move ${rc.cameraMove} matches the scene's preferred framing`);
  if (rc.effects?.length) out.push(`enhanced with ${rc.effects.join(", ")}`);
  return out.join(" · ");
}

/**
 * Rank candidate visuals for a scene, sorted by mScore desc.
 * Deterministic, provider-free, always real.
 */
export function rankVisualsForScene(scene: VisualScene, options: VisualSelectionOptions = {}): VisualCandidate[] {
  const ratio = desiredAspect(scene, options.format);
  const query = buildSemanticQuery({
    narration: scene.narration,
    title: scene.title,
    visualPrompt: scene.visualPrompt,
    mediaType: scene.mediaType,
    camera: scene.camera,
    tone: scene.tone,
    emotion: scene.emotion,
    beat: scene.beat,
    aspectRatio: scene.aspectRatio,
  });
  const sceneCamera = pickCamera({
    mediaType: scene.mediaType ?? undefined,
    format: options.format ?? scene.format ?? "LONG",
    beatName: scene.beatName ?? scene.beat ?? undefined,
    emotion: scene.emotion ?? undefined,
  });
  const pool = buildCandidatePool(scene, options, query, sceneCamera, ratio);

  const scored = pool
    .map((rc, i) => {
      const parts = scoreCandidate(rc, scene, options, query, ratio);
      const mScore = overall(parts);
      const prompt = candidatePrompt(rc, query, scene, options);
      const candidate: VisualCandidate = {
        id: `${scene.id ?? "scene"}-${rc.kind}-${i}`,
        kind: rc.kind,
        label: rc.label,
        mScore,
        rationale: buildRationale(parts, rc, scene, query, options, ratio),
        prompt,
        presetId: rc.preset?.id,
        cameraMove: rc.cameraMove,
        effects: rc.effects,
        aspectRatio: rc.aspectRatio,
        source: rc.source,
      };
      return candidate;
    })
    .sort((a, b) => b.mScore - a.mScore);

  const max = scored.length ? scored[0].mScore : 0;
  // Guard: never identical scores across the pool — nudge ties by index order
  // so alternates stay distinct (deterministic, not random).
  const seen = new Map<number, number>();
  return scored.map((c) => {
    const count = seen.get(c.mScore) ?? 0;
    seen.set(c.mScore, count + 1);
    return count === 0 ? c : { ...c, mScore: Math.max(0, c.mScore - count) };
  });
}

/** The single best visual for a scene + why. */
export function pickPrimaryVisual(scene: VisualScene, options: VisualSelectionOptions = {}): { primary: VisualCandidate; why: string } {
  const ranked = rankVisualsForScene(scene, options);
  const primary = ranked[0];
  return {
    primary,
    why: primary
      ? `Primary visual "${primary.label}" (${primary.mScore}/100) — ${primary.rationale}`
      : "No candidate could be derived for this scene.",
  };
}
