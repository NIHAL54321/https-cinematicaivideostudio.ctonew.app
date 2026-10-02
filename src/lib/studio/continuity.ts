/**
 * Phase 3 — Visual Continuity (deterministic cross-scene consistency).
 *
 * Tracks recurring characters, subjects, locations, props, lighting mood and
 * style preset across the scenes of a project, so the same character or
 * location stays visually consistent shot-to-shot.
 *
 * Everything here is HEURISTIC and DETERMINISTIC — it scans scene text for
 * recurring named entities and derives a consistent style look from the
 * project preset. It never fabricates, never touches the network, and never
 * claims any media exists. Augmentation only edits the VISUAL PROMPT (a
 * structural anchor string); narration, script and timing are left untouched.
 */
import { buildSemanticQuery } from "@/lib/media/semantic";
import { getPreset } from "./presets";
import type { VisualScene } from "./visual-selection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContinuityEntity {
  name: string;
  scenes: number[]; // 0-based scene indices it appears in
  firstScene: number;
}

export interface ContinuityState {
  characters: ContinuityEntity[];
  locations: ContinuityEntity[];
  props: ContinuityEntity[];
  stylePreset: string | null;
  /** A short lighting phrase consistent across the project. */
  lighting: string | null;
  palette: string[];
  /** Transparency label — this is a heuristic scan, not AI. */
  source: "continuity-heuristic";
}

// ---------------------------------------------------------------------------
// Tokenization / stopwords / patterns
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the","and","that","with","this","these","those","from","into","over","under","onto","upon",
  "your","our","their","when","what","which","should","would","could","then","than","there",
  "here","where","have","has","had","been","being","were","was","will","shall","can","may",
  "must","about","after","before","between","through","during","within","without","because",
  "something","someone","everyone","everything","while","until","against","again","also","just",
  "like","scene","scenes","camera","shot","wide","close","medium","establishing","the","a","an",
  "one","two","three","you","your","its","their","them","they","she","he","it","we","us","not",
]);

const LOCATION_PATTERNS = [
  /\b(city|urban|downtown|street|skyline|office|tower|building)\w*\b/i,
  /\b(nature|forest|mountain|ocean|beach|desert|jungle|field|river|sea|coast)\w*\b/i,
  /\b(room|home|house|lobby|hall|interior|kitchen|bedroom|garden|park|plaza)\w*\b/i,
  /\b(road|highway|bridge|station|airport|factory|laboratory|lab|classroom)\w*\b/i,
];

const LIGHTING_BY_TONE: Record<string, string> = {
  cinematic: "dramatic key light, deep shadows",
  dramatic: "low-key, high contrast",
  mysterious: "partial light, silhouettes",
  calm: "soft diffused natural light",
  emotional: "warm soft light",
  inspirational: "golden hour glow",
  energetic: "bright punchy studio light",
  tense: "hard shadows, suspense",
  nostalgic: "warm vintage glow",
  documentary: "available natural light",
};

/** Clean tokens from text (dedup, len filter). */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9'’-]+/)) {
    const t = raw.trim();
    if (!t || t.length < 2) continue;
    out.push(t);
  }
  return out;
}

function isCapitalized(w: string): boolean {
  // First letter uppercase, rest contains at least one lowercase (a real name).
  return /^[A-Z][a-zà-ÿ]/.test(w) && !STOPWORDS.has(w.toLowerCase());
}

/** Decide which scene-indexed entities recur (>=2 scenes) as a named class. */
function collectRecurring(presence: Map<string, Set<number>>): ContinuityEntity[] {
  const out: ContinuityEntity[] = [];
  for (const [name, scenes] of presence) {
    if (scenes.size < 2) continue; // must recur to be "consistent" across scenes
    const arr = [...scenes].sort((a, b) => a - b);
    out.push({ name, scenes: arr, firstScene: arr[0] });
  }
  return out.sort((a, b) => a.scenes.length - b.scenes.length !== 0 ? b.scenes.length - a.scenes.length : a.firstScene - b.firstScene);
}

function isLocationWord(w: string): boolean {
  return LOCATION_PATTERNS.some((re) => re.test(w));
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Build a ContinuityState by scanning every scene's narration / title / visual
 * prompt for recurring named entities and consistent style. Deterministic.
 */
export function extractContinuity(scenes: VisualScene[], options: { presetId?: string | null } = {}): ContinuityState {
  const charPresence = new Map<string, Set<number>>();
  const locPresence = new Map<string, Set<number>>();
  const propPresence = new Map<string, Set<number>>();
  const presetCount = new Map<string, number>();
  const toneCount = new Map<string, number>();

  scenes.forEach((scene, idx) => {
    const text = [scene.narration, scene.title, scene.visualPrompt].filter(Boolean).join(" ");
    const toks = tokens(text);
    const alreadyChar = new Set<string>();
    const alreadyLoc = new Set<string>();
    const alreadyProp = new Set<string>();

    for (const raw of toks) {
      const low = raw.toLowerCase();
      if (isCapitalized(raw)) {
        const name = low;
        if (!alreadyChar.has(name)) {
          alreadyChar.add(name);
          if (!charPresence.has(name)) charPresence.set(name, new Set());
          charPresence.get(name)!.add(idx);
        }
      } else if (isLocationWord(raw)) {
        const name = low;
        if (!alreadyLoc.has(name)) {
          alreadyLoc.add(name);
          if (!locPresence.has(name)) locPresence.set(name, new Set());
          locPresence.get(name)!.add(idx);
        }
      } else if (low.length >= 5 && !STOPWORDS.has(low)) {
        const name = low;
        if (!alreadyProp.has(name)) {
          alreadyProp.add(name);
          if (!propPresence.has(name)) propPresence.set(name, new Set());
          propPresence.get(name)!.add(idx);
        }
      }
    }

    // Semantic signals also contribute location candidates.
    const q = buildSemanticQuery({
      narration: scene.narration,
      title: scene.title,
      visualPrompt: scene.visualPrompt,
      mediaType: scene.mediaType,
      tone: scene.tone,
      emotion: scene.emotion,
    });
    for (const loc of q.location) {
      if (!alreadyLoc.has(loc)) {
        alreadyLoc.add(loc);
        if (!locPresence.has(loc)) locPresence.set(loc, new Set());
        locPresence.get(loc)!.add(idx);
      }
    }

    const pid = scene.presetId ?? options.presetId;
    if (pid) presetCount.set(pid, (presetCount.get(pid) ?? 0) + 1);
    if (scene.tone) toneCount.set(scene.tone, (toneCount.get(scene.tone) ?? 0) + 1);
  });

  // Style preset: most frequent across scenes, else the option, else default.
  let stylePreset: string | null = null;
  let best = -1;
  for (const [pid, c] of presetCount) {
    if (c > best) {
      best = c;
      stylePreset = pid;
    }
  }
  if (!stylePreset && options.presetId) stylePreset = options.presetId;
  if (!stylePreset) stylePreset = "cinematic";

  // Lighting: derived from the most frequent tone, else the preset's lighting.
  let lightTone = "";
  let toneBest = -1;
  for (const [t, c] of toneCount) {
    if (c > toneBest) {
      toneBest = c;
      lightTone = t;
    }
  }
  const lighting = LIGHTING_BY_TONE[lightTone] ?? getPreset(stylePreset).lighting[0] ?? "consistent cinematic lighting";

  const preset = getPreset(stylePreset);
  const palette = preset.colors.slice(0, 3);

  return {
    characters: collectRecurring(charPresence),
    locations: collectRecurring(locPresence),
    props: collectRecurring(propPresence),
    stylePreset,
    lighting,
    palette,
    source: "continuity-heuristic",
  };
}

// ---------------------------------------------------------------------------
// Augmentation
// ---------------------------------------------------------------------------

const ANCHOR_START = "[continuity:";
const ANCHOR_END = "[/continuity]";

/** Strip any previously-applied continuity anchor (idempotent augmentation). */
function stripAnchor(prompt: string | null): string {
  if (!prompt) return "";
  const start = prompt.indexOf(ANCHOR_START);
  if (start === -1) return prompt.trim();
  const end = prompt.indexOf(ANCHOR_END, start);
  const before = prompt.slice(0, start).replace(/[,\s]+$/, "").trim();
  const after = end === -1 ? "" : prompt.slice(end + ANCHOR_END.length).replace(/^[,\s]+/, "").trim();
  return [before, after].filter(Boolean).join(", ");
}

/** Which continuity entities appear in a given scene's text. */
export function entitiesIn(
  scene: VisualScene,
  state: ContinuityState,
): { characters: ContinuityEntity[]; locations: ContinuityEntity[]; props: ContinuityEntity[] } {
  const text = [scene.narration, scene.title, scene.visualPrompt].filter(Boolean).join(" ").toLowerCase();
  const chars = state.characters.filter((e) => text.includes(e.name));
  const locs = state.locations.filter((e) => text.includes(e.name));
  const props = state.props.filter((e) => text.includes(e.name));
  return { characters: chars, locations: locs, props: props };
}

/**
 * Return scenes whose VISUAL PROMPT is augmented with continuity anchors.
 * Narration, script, titles, order and timing are never modified.
 */
export function augmentScenesWithContinuity(scenes: VisualScene[], state: ContinuityState): VisualScene[] {
  return scenes.map((scene, idx) => {
    const { characters, locations, props } = entitiesIn(scene, state);
    const parts: string[] = [];
    for (const c of characters) {
      parts.push(`character: ${c.name} — keep the same appearance as earlier scenes (scenes ${c.scenes.join(", ")}, 0-based)`);
    }
    for (const l of locations) {
      parts.push(`location: ${l.name} — keep consistent architecture and lighting with earlier scenes`);
    }
    if (props.length) {
      parts.push(`props: ${props.map((p) => p.name).join(", ")} — keep consistent look`);
    }
    if (parts.length === 0) return scene; // untouched

    const anchor = `${ANCHOR_START} ${parts.join("; ")} ${ANCHOR_END}`;
    const base = stripAnchor(scene.visualPrompt ?? null);
    const care = scene; // preserving reference semantics for non-mutated fields
    return {
      ...care,
      visualPrompt: base.length ? `${base}, ${anchor}` : anchor,
      // explicit, defensive no-op fields remain untouched (narration/timing preserved)
      narration: scene.narration,
      durationSeconds: scene.durationSeconds,
      title: scene.title,
      order: scene.order,
      id: scene.id,
    };
  });
}
