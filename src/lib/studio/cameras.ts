/**
 * Camera / shot-type engine — the 15 shot types with their storytelling
 * rationale, plus a deterministic `pickCamera` heuristic per scene.
 * Structure, not AI: it explains WHY a shot fits, it never invents footage.
 */
export interface ShotType {
  id: string;
  name: string;
  rationale: string;
  bestFor: string[];
  mood: string;
}

export const SHOT_TYPES: ShotType[] = [
  { id: "wide", name: "Wide", rationale: "Establishes scale and context in one frame.", bestFor: ["hook", "destination", "scale", "before"], mood: "Context, scale" },
  { id: "establishing", name: "Establishing", rationale: "Orients the viewer in a new place or era.", bestFor: ["hook", "context", "setup", "start", "ordinary-world"], mood: "Place, orientation" },
  { id: "medium", name: "Medium", rationale: "Comfortable distance for explanation and conversation.", bestFor: ["explanation", "answers", "items", "solution", "how-it-works"], mood: "Clarity, engagement" },
  { id: "close-up", name: "Close-up", rationale: "Forces attention on a detail or reaction.", bestFor: ["evidence", "example", "clues", "pain-points", "twist"], mood: "Focus, intensity" },
  { id: "extreme-close-up", name: "Extreme close-up", rationale: "Magnifies the smallest, most telling detail.", bestFor: ["shock", "twist", "reveal", "statistics", "clues"], mood: "Tension, intimacy" },
  { id: "macro", name: "Macro", rationale: "Reveals texture invisible at normal distance.", bestFor: ["example", "before", "transformation", "craft"], mood: "Wonder, detail" },
  { id: "pov", name: "POV", rationale: "Puts the viewer inside the action.", bestFor: ["journey", "story", "conflict", "obstacles"], mood: "Immersion, stakes" },
  { id: "tracking", name: "Tracking", rationale: "Moves with the subject; momentum and progression.", bestFor: ["journey", "timeline", "obstacles", "destination"], mood: "Motion, progression" },
  { id: "dolly", name: "Dolly", rationale: "Slow push-in signals a shift — a realization approaching.", bestFor: ["discovery", "turning-point", "transformation", "crisis"], mood: "Anticipation, emphasis" },
  { id: "crane", name: "Crane", rationale: "Rises above the scene for a concluding sweep.", bestFor: ["conclusion", "cta", "resolution", "after", "return"], mood: "Resolution, grandeur" },
  { id: "drone", name: "Drone", rationale: "Smooth airborne movement over large spaces.", bestFor: ["destination", "journey", "scale", "map", "timeline"], mood: "Scale, freedom" },
  { id: "aerial", name: "Aerial", rationale: "God's-eye view — the shape of a place or era.", bestFor: ["map", "timeline", "context", "scale", "turning-point"], mood: "Perspective, overview" },
  { id: "rack-focus", name: "Rack focus", rationale: "Shifts attention from one plane to another — a reveal.", bestFor: ["reveal", "twist", "clues", "discovery"], mood: "Reveal, intrigue" },
  { id: "slow-motion", name: "Slow motion", rationale: "Dwells on a pivotal moment.", bestFor: ["emotional", "turning-point", "crisis", "transformation", "shock"], mood: "Weight, emotion" },
  { id: "time-lapse", name: "Time lapse", rationale: "Compresses long change into seconds.", bestFor: ["timeline", "transformation", "after", "evolution"], mood: "Change, passage" },
];

export function getShotType(id: string): ShotType | undefined {
  return SHOT_TYPES.find((s) => s.id === id);
}

export interface PickCameraInput {
  beatId?: string;
  beatName?: string;
  mediaType?: string;
  format?: string;
  emotion?: string;
}

export interface CameraDecision {
  shot: ShotType;
  rationale: string;
}

/** Deterministic shot heuristics per beat/media — never random. */
export function pickCamera(input: PickCameraInput): CameraDecision {
  const beat = (input.beatId ?? "").toLowerCase();
  const name = (input.beatName ?? "").toLowerCase();
  const media = (input.mediaType ?? "").toUpperCase();
  const emotion = (input.emotion ?? "").toLowerCase();
  const text = `${beat} ${name}`;

  const id = (() => {
    if (media === "MAP" || media === "TIMELINE") return "aerial";
    if (media === "CHART" || media === "NUMBER_ANIMATION") return "extreme-close-up";
    if (media === "SCREEN_SIMULATION" || media === "TEXT_ANIMATION") return "medium";
    if (media === "INFOGRAPHIC") return "close-up";
    if (text.includes("hook") || text.includes("context") || text.includes("setup") || text.includes("ordinary"))
      return "establishing";
    if (text.includes("reveal") || text.includes("twist") || text.includes("discovery") || text.includes("clues"))
      return "rack-focus";
    if (text.includes("crisis") || text.includes("turning") || text.includes("transform"))
      return emotion === "calm" ? "time-lapse" : "dolly";
    if (text.includes("emotional") || text.includes("moment") || text.includes("feeling")) return "slow-motion";
    if (text.includes("journey") || text.includes("obstacles") || text.includes("story")) return "tracking";
    if (text.includes("destination") || text.includes("after") || text.includes("return")) return "crane";
    if (text.includes("timeline") || text.includes("history") || text.includes("evolution")) return "time-lapse";
    if (text.includes("statistic") || text.includes("evidence") || text.includes("example")) return "close-up";
    if (text.includes("cta") || text.includes("conclusion") || text.includes("resolution") || text.includes("recap"))
      return "medium";
    if (media === "STOCK") return "wide";
    if (media === "AI_VIDEO") return "wide";
    return "medium";
  })();

  const shot = getShotType(id)!;
  return {
    shot,
    rationale: `${shot.name} — ${shot.rationale.toLowerCase()}`,
  };
}
