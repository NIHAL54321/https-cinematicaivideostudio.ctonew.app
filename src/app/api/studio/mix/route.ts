import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { blendWithDucking, buildMix, type AudioMixInput } from "@/lib/mix";
import type { DuckingEvent, DuckingSchedule } from "@/lib/music";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = ["mix"] as const;
type MixAction = (typeof ALLOWED_ACTIONS)[number];

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function gain(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return Math.min(1, Math.max(0, n));
}

function parseCues(v: unknown): Array<{ startMs: number; endMs: number; gain: number }> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const startMs = num(c.startMs);
      const endMs = num(c.endMs);
      if (startMs === undefined || endMs === undefined || endMs <= startMs) return null;
      return { startMs, endMs, gain: gain(c.gain) ?? 0.8 };
    })
    .filter((c): c is { startMs: number; endMs: number; gain: number } => c !== null);
  return out.length > 0 ? out : undefined;
}

function parseTrack(v: unknown, kind: "voice" | "music" | "sfx" | "ambient") {
  const t = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const g = gain(t.gain);
  if (g !== undefined) out.gain = g;
  if (kind === "music") {
    const depth = num(t.duckedDepthDb);
    if (depth !== undefined) out.duckedDepthDb = Math.abs(depth);
    const fadeIn = num(t.fadeInMs);
    if (fadeIn !== undefined) out.fadeInMs = fadeIn;
    const fadeOut = num(t.fadeOutMs);
    if (fadeOut !== undefined) out.fadeOutMs = fadeOut;
  }
  const cues = parseCues(t.cues ?? t.segments ?? t.clips);
  if (cues) {
    out[kind === "music" ? "segments" : kind === "voice" ? "clips" : "cues"] = cues;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Normalize a JSON ducking schedule to the DuckingSchedule shape. */
function parseDucking(v: unknown): DuckingSchedule | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const d = v as Record<string, unknown>;
  if (!Array.isArray(d.ducking)) return undefined;
  const events: DuckingEvent[] = d.ducking
    .map((raw) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      const startMs = num(e.startMs);
      const endMs = num(e.endMs);
      const dB = num(e.dB);
      if (startMs === undefined || endMs === undefined || dB === undefined || endMs <= startMs) return null;
      return { startMs, endMs, dB, reason: (e.reason ?? "narrating") as DuckingEvent["reason"] };
    })
    .filter((e): e is DuckingEvent => e !== null)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (events.length === 0) return undefined;
  const m = (d.mix ?? {}) as Record<string, unknown>;
  return {
    ducking: events,
    mix: {
      musicVolume: gain(m.musicVolume) ?? 0.7,
      duckedDepthDb: Math.abs(num(m.duckedDepthDb) ?? 6),
      fadeInMs: num(m.fadeInMs) ?? 600,
      fadeOutMs: num(m.fadeOutMs) ?? 1200,
    },
    timingModel: "EXPLICIT: ducking schedule supplied by the caller.",
  };
}

function asJsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:mix", 30);
    const body = (await readJson(req)) as Record<string, unknown>;
    const action = body.action as MixAction | undefined;
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return ok(
        { connected: false, error: "Unknown action.", note: "Expected one of: " + ALLOWED_ACTIONS.join(", ") },
        400,
      );
    }

    const input: AudioMixInput = {};
    const voice = parseTrack(body.voice, "voice");
    const music = parseTrack(body.music, "music");
    const sfx = parseTrack(body.sfx, "sfx");
    const ambient = parseTrack(body.ambient, "ambient");
    if (voice) input.voice = voice;
    if (music) input.music = music;
    if (sfx) input.sfx = sfx;
    if (ambient) input.ambient = ambient;
    if (num(body.loudnessTarget) !== undefined) input.loudnessTarget = Math.min(0, Math.max(-60, num(body.loudnessTarget)!));

    const ducking = parseDucking(body.ducking);
    const plan = buildMix(input);
    const ducked = ducking ? blendWithDucking(plan, ducking) : null;

    return ok(
      asJsonSafe({
        connected: false,
        action: "mix",
        plan,
        ...(ducked ? { ducked } : {}),
        clipping: plan.clipping,
        loudness: plan.loudness,
        note: ducking
          ? "This is a deterministic mix PLAN — this app has no audio renderer, so the plan is what the mix engine produces. Music gain was modulated by the provided ducking schedule."
          : "This is a deterministic mix PLAN — this app has no audio renderer, so the plan is what the mix engine produces. No ducking schedule was provided.",
      }),
    );
  } catch (err) {
    return apiError(err);
  }
}