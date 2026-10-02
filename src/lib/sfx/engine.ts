/**
 * Phase 4 Block 2 — Sound FX engine (deterministic, pure, no IO).
 *
 * Conservative by design: SFX are sparse accents, not wallpaper. The library
 * lists licensed effect types (no fabricated audio); selection is a pure
 * function of scene text + transition type. Provider synthesis goes through
 * the AI Model Orchestrator ("sound_effects").
 */

export type SfxCategory = "transition" | "emphasis" | "ambience" | "ui";

export interface SoundEffectDef {
  id: string;
  name: string;
  category: SfxCategory;
  description: string;
  /** Where the effect is safe to use (transition / emphasis / ambience / ui). */
  usage: string;
  /** Relative likelihood 0-1 (helps ranking; conservative overall). */
  weight: number;
  /** Typical rendered length in ms (used for schedule gaps). */
  typicallyShortMs: number;
  /** Lowercase topic keywords that steer selection (ambience/ui only). */
  keywords: string[];
}

export const SFX_LIBRARY: SoundEffectDef[] = [
  {
    id: "whoosh",
    name: "Whoosh",
    category: "transition",
    description: "Short accelerating sweep that punctuates cuts and entrances.",
    usage: "transition",
    weight: 0.9,
    typicallyShortMs: 700,
    keywords: [], // selected purely via transitionType — see selectSfxForScene
  },
  {
    id: "impact",
    name: "Impact",
    category: "transition",
    description: "Heavy hit for reveals, cuts and punctuation beats.",
    usage: "transition",
    weight: 0.85,
    typicallyShortMs: 900,
    keywords: [], // selected purely via transitionType — see selectSfxForScene
  },
  {
    id: "camera",
    name: "Camera shutter",
    category: "emphasis",
    description: "Shutter click / focus beep for snapshots and reveals.",
    usage: "emphasis",
    weight: 0.6,
    typicallyShortMs: 250,
    keywords: ["camera", "photo", "picture", "snapshot", "focus", "lens", "shoot"],
  },
  {
    id: "keyboard",
    name: "Keyboard typing",
    category: "ui",
    description: "Quiet mechanical typing for tech and code scenes.",
    usage: "ui",
    weight: 0.5,
    typicallyShortMs: 800,
    keywords: ["keyboard", "typing", "keys", "code", "type", "laptop"],
  },
  {
    id: "footsteps",
    name: "Footsteps",
    category: "ambience",
    description: "Footsteps for walk-and-talk, approaches and entrances.",
    usage: "ambience",
    weight: 0.5,
    typicallyShortMs: 1200,
    keywords: ["footsteps", "walk", "walking", "run", "running", "approach", "steps", "tread"],
  },
  {
    id: "crowd",
    name: "Crowd murmur",
    category: "ambience",
    description: "Low crowd murmur for events, stadiums and audiences.",
    usage: "ambience",
    weight: 0.6,
    typicallyShortMs: 2000,
    keywords: ["crowd", "audience", "people", "stadium", "event", "cheers", "concert"],
  },
  {
    id: "traffic",
    name: "Traffic",
    category: "ambience",
    description: "Distant traffic bed for streets and road scenes.",
    usage: "ambience",
    weight: 0.55,
    typicallyShortMs: 2000,
    keywords: ["traffic", "car", "cars", "street", "road", "highway", "drive"],
  },
  {
    id: "nature",
    name: "Nature",
    category: "ambience",
    description: "Forest birdsong and breeze for outdoor scenes.",
    usage: "ambience",
    weight: 0.7,
    typicallyShortMs: 2500,
    keywords: ["nature", "forest", "birds", "outdoor", "park", "tree", "jungle", "wildlife", "countryside"],
  },
  {
    id: "water",
    name: "Water",
    category: "ambience",
    description: "Water lapping / rain for aquatic and weather scenes.",
    usage: "ambience",
    weight: 0.65,
    typicallyShortMs: 2000,
    keywords: ["water", "ocean", "sea", "wave", "river", "rain", "lake", "waterfall"],
  },
  {
    id: "wind",
    name: "Wind",
    category: "ambience",
    description: "Soft wind for mountains, deserts and empty spaces.",
    usage: "ambience",
    weight: 0.6,
    typicallyShortMs: 1800,
    keywords: ["wind", "breeze", "gale", "desert", "mountain", "summit", "empty"],
  },
  {
    id: "city-ambience",
    name: "City ambience",
    category: "ambience",
    description: "City hum — horns, sirens, distant chatter — for urban scenes.",
    usage: "ambience",
    weight: 0.7,
    typicallyShortMs: 2200,
    keywords: ["city", "urban", "downtown", "metropolis", "night city", "skyline", "neon"],
  },
  {
    id: "door",
    name: "Door",
    category: "emphasis",
    description: "Door knock / open / close for threshold moments.",
    usage: "emphasis",
    weight: 0.55,
    typicallyShortMs: 400,
    keywords: ["door", "knock", "open", "close", "slam", "entrance", "threshold"],
  },
  {
    id: "notification",
    name: "Notification",
    category: "ui",
    description: "Soft notification ding for messages and alerts.",
    usage: "ui",
    weight: 0.5,
    typicallyShortMs: 350,
    keywords: ["notification", "alert", "message", "ding", "ping", "email", "inbox"],
  },
  {
    id: "digital-effects",
    name: "Digital effects",
    category: "ui",
    description: "UI sweeps and digital blips for interfaces, data and robots.",
    usage: "ui",
    weight: 0.55,
    typicallyShortMs: 600,
    keywords: ["digital", "interface", "app", "software", "data", "code", "robot", "ai", "screen", "ui", "hologram"],
  },
];

export const SFX_BY_ID: Record<string, SoundEffectDef> = Object.fromEntries(
  SFX_LIBRARY.map((s) => [s.id, s]),
);

export function findSfx(id: string | undefined): SoundEffectDef | null {
  if (!id) return null;
  return SFX_BY_ID[id.trim()] ?? null;
}

/** Strong-beat words that justify an emphasis effect (exclamation alternate). */
const STRONG_WORDS = [
  "boom", "crash", "huge", "incredible", "explosive", "massive", "stunning",
  "punch", "hit", "smash", "bang", "thunder", "roar", "sudden", "pound",
];
/** Digital-topic words that open the ui lane. */
const DIGITAL_WORDS = [
  "digital", "tech", "technology", "computer", "software", "app", "application",
  "keyboard", "typing", "notification", "alert", "message", "email", "phone",
  "interface", "ui", "data", "code", "robot", "ai", "screen", "hologram", "gadget",
];

function countWords(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = lower.match(new RegExp(`\\b${escaped}\\b`, "g"));
    if (m) hits += m.length;
  }
  return hits;
}

export interface SceneForSfx {
  text: string;
  transitionType?: string | null;
}

export interface RankedSfxCandidate {
  sfxId: string;
  reason: string;
  gain: number;
}

/**
 * Rank candidate effects for ONE scene. Deterministic. Rules:
 * - whoosh / impact appear ONLY when transitionType matches them;
 * - emphasis effects (camera, door) appear on exclamations / strong beats;
 * - ambience effects appear ONLY on keyword match;
 * - ui effects (keyboard, notification, digital-effects) only on digital topics.
 * Returns [] for plain talking scenes.
 */
export function selectSfxForScene(scene: SceneForSfx): RankedSfxCandidate[] {
  const text = (scene.text ?? "").trim();
  if (!text) return [];
  const transition = (scene.transitionType ?? "").trim().toLowerCase();
  const exclamations = (text.match(/!/g) ?? []).length;
  const strongHits = countWords(text, STRONG_WORDS);
  const strongBeat = exclamations >= 1 || strongHits > 0;
  const digitalHits = countWords(text, DIGITAL_WORDS);

  const scored: Array<RankedSfxCandidate & { score: number }> = [];

  for (const sfx of SFX_LIBRARY) {
    let score = 0;
    let reason = "";

    if (sfx.category === "transition") {
      if (transition === sfx.id) {
        score = 100 + Math.round(sfx.weight * 20);
        reason = `transition type "${sfx.id}"`;
      }
      // transition effects NEVER fire on keywords or beats — strict.
    } else if (sfx.category === "ambience") {
      const hits = countWords(text, sfx.keywords);
      if (hits > 0) {
        score = 40 + hits * 15 + Math.round(sfx.weight * 10);
        reason = `${hits} ambience keyword hit${hits > 1 ? "s" : ""}`;
      }
    } else if (sfx.category === "ui") {
      if (digitalHits > 0) {
        const hits = countWords(text, sfx.keywords);
        const bonus = transition === "ui" ? 20 : 0;
        score = 30 + hits * 12 + digitalHits * 6 + Math.round(sfx.weight * 10) + bonus;
        reason = `digital topic${transition === "ui" ? " + ui transition" : ""}`;
      }
    } else {
      // emphasis
      const hits = countWords(text, sfx.keywords);
      if (strongBeat) {
        score = 25 + exclamations * 12 + strongHits * 8 + hits * 6 + Math.round(sfx.weight * 10);
        reason = exclamations > 0 ? `exclamation beat (${exclamations})` : `strong beat (${strongHits} hit${strongHits > 1 ? "s" : ""})`;
      }
    }

    if (score > 0) {
      const gain = Math.round(Math.min(0.95, 0.3 + sfx.weight * 0.45 + Math.min(0.15, score / 500)) * 100) / 100;
      scored.push({ sfxId: sfx.id, reason, gain, score });
    }
  }

  // Transition matches first (preferTransitions), then score desc, then id.
  scored.sort((a, b) => {
    const ta = SFX_BY_ID[a.sfxId].category === "transition" ? 1 : 0;
    const tb = SFX_BY_ID[b.sfxId].category === "transition" ? 1 : 0;
    return tb - ta || b.score - a.score || (a.sfxId < b.sfxId ? -1 : 1);
  });

  return scored.map(({ sfxId, reason, gain }) => ({ sfxId, reason, gain }));
}

export interface ScenePlanInput {
  sceneId?: string;
  text: string;
  durationMs?: number;
  transitionType?: string | null;
}

export interface PlacementPolicy {
  maxPerScene: number;
  preferTransitions: boolean;
  minGapMs: number;
}

/** Enforced (not merely documented): ≤ maxPerScene, ≥ minGapMs between hits. */
export const placementPolicy: PlacementPolicy = { maxPerScene: 2, preferTransitions: true, minGapMs: 1500 };

export interface SfxScheduledEvent {
  sceneId?: string;
  startMs: number;
  endMs: number;
  sfxId: string;
  category: SfxCategory;
  reason: string;
  gain: number;
}

export interface SfxPlan {
  schedule: SfxScheduledEvent[];
  policy: PlacementPolicy;
  timingModel: string;
}

/**
 * Plan sparse SFX across scenes. Conservative defaults:
 * - no SFX on plain talking scenes (empty candidate list);
 * - ≤ 2 effects per scene, transitions preferred;
 * - effects are ≥ minGapMs apart in the final timeline;
 * - a scene with an unknown duration is estimated at DEFAULT_SCENE_MS.
 */
export function planSoundEffects(input: { scenes: ScenePlanInput[]; tone?: string }): SfxPlan {
  const DEFAULT_SCENE_MS = 4000;
  const schedule: SfxScheduledEvent[] = [];
  let timeline = 0;
  let lastEndMs = -Infinity;
  const tone = (input.tone ?? "").trim().toLowerCase();

  for (const scene of input.scenes) {
    if (!scene || !scene.text || !scene.text.trim()) {
      timeline += scene && scene.durationMs ? scene.durationMs : DEFAULT_SCENE_MS;
      continue;
    }
    const durationMs = scene.durationMs && Number.isFinite(scene.durationMs) ? Math.round(scene.durationMs) : DEFAULT_SCENE_MS;
    const sceneStart = timeline;
    const cands = selectSfxForScene({ text: scene.text, transitionType: scene.transitionType });
    let placed = 0;

    for (const cand of cands) {
      if (placed >= placementPolicy.maxPerScene) break;
      const def = SFX_BY_ID[cand.sfxId];
      if (!def) continue;
      // Calm/serious/documentary tone tames emphasis effects.
      const toneCut = tone === "calm" || tone === "serious" || tone === "documentary" ? 0.6 : 1;
      if (def.category === "emphasis" && toneCut < 1) continue;

      let startMs = sceneStart;
      if (cand.reason.startsWith("transition")) startMs += 150;
      else if (def.category === "ambience") startMs += 300;
      else startMs += 150 + placed * placementPolicy.minGapMs;

      // Global min-gap enforcement: delay rather than overlap, skip if it no
      // longer fits inside the scene.
      const minStart = lastEndMs + placementPolicy.minGapMs;
      if (startMs < minStart) startMs = minStart;
      const endMs = startMs + def.typicallyShortMs;
      if (endMs > sceneStart + durationMs) {
        // Scene too short to host this effect without overflowing — skip.
        continue;
      }
      schedule.push({
        sceneId: scene.sceneId,
        startMs,
        endMs,
        sfxId: def.id,
        category: def.category,
        reason: cand.reason,
        gain: cand.gain,
      });
      lastEndMs = endMs;
      placed++;
    }
    timeline = sceneStart + durationMs;
  }

  return {
    schedule,
    policy: { ...placementPolicy },
    timingModel:
      "ESTIMATE: scenes without explicit durationMs are assumed 4s; effect lengths are catalog typicals. Real lengths come from the provider.",
  };
}