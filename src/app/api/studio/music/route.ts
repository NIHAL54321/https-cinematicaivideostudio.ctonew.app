import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { capabilityEnvNames, capabilityStatus, execute, requiredEnvFor } from "@/lib/ai";
import type { AiTask } from "@/lib/ai";
import {
  MUSIC_CATEGORIES,
  buildDuckingSchedule,
  findMusicCategory,
  selectMusic,
  type DuckingVoicePlan,
} from "@/lib/music";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = ["select", "duck"] as const;
type MusicAction = (typeof ALLOWED_ACTIONS)[number];

/**
 * Server-side env var NAMES (never values) that could enable music_generation.
 * Derived from the provider env-key registry via the capability→provider slot
 * table — never a literal list, so every name is one some code actually reads.
 */
const MUSIC_REQUIRED_ENV = capabilityEnvNames("music_generation");

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asJsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:music", 30);
    const body = (await readJson(req)) as Record<string, unknown>;
    const action = body.action as MusicAction | undefined;
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return ok(
        { connected: false, error: "Unknown action.", note: "Expected one of: " + ALLOWED_ACTIONS.join(", ") },
        400,
      );
    }

    // ----- duck: deterministic mix preview, no provider ----------------------
    if (action === "duck") {
      const voicePlan = body.voicePlan as DuckingVoicePlan | undefined;
      if (!voicePlan || !Array.isArray(voicePlan.segments) || voicePlan.segments.length === 0) {
        return ok(
          {
            connected: false,
            error: "Missing voicePlan.",
            note: 'Provide "voicePlan" with segments (each with startMs/endMs, or a DirectedVoicePlan from the voice studio) to compute ducking.',
          },
          400,
        );
      }
      let musicSegments: { startMs: number; endMs: number }[] | undefined;
      if (Array.isArray(body.musicSegments)) {
        musicSegments = body.musicSegments
          .filter((m): m is { startMs: number; endMs: number } => {
            const r = m as { startMs?: unknown; endMs?: unknown };
            return typeof r.startMs === "number" && typeof r.endMs === "number";
          })
          .map((r) => ({ startMs: r.startMs, endMs: r.endMs }));
      }
      const schedule = buildDuckingSchedule({
        voicePlan: voicePlan as never,
        musicSegments,
        musicVolume: num(body.musicVolume),
        duckedDepthDb: num(body.duckedDepthDb),
        fadeInMs: num(body.fadeInMs),
        fadeOutMs: num(body.fadeOutMs),
      });
      return ok(
        asJsonSafe({
          connected: false,
          action: "duck",
          ducking: schedule.ducking,
          mix: schedule.mix,
          timingModel: schedule.timingModel,
          note: "Ducking is a deterministic mix preview (no provider needed). Music generation itself requires a provider.",
        }),
      );
    }

    // ----- select: deterministic ranking + provider dispatch ------------------
    const topic = str(body.topic);
    const emotion = str(body.emotion);
    const sceneType = str(body.sceneType);
    const pace = str(body.pace);
    const genre = str(body.genre);
    if (!topic && !sceneType && !genre && !emotion && !pace) {
      return ok(
        { connected: false, error: "Missing input.", note: 'Provide at least one of "topic", "emotion", "sceneType", "pace" or "genre".' },
        400,
      );
    }

    const ranking = selectMusic({ topic, emotion, sceneType, pace, genre });
    const top = ranking.top;
    const category = findMusicCategory(top.categoryId);

    const status = capabilityStatus("music_generation");
    if (status.status !== "connected") {
      const requiredEnv = MUSIC_REQUIRED_ENV;
      return ok(
        asJsonSafe({
          connected: false,
          action: "select",
          capability: "music_generation",
          requiredEnv,
          envHint: requiredEnv[0],
          availableCategories: MUSIC_CATEGORIES,
          ranked: ranking.ranked,
          top,
          selected: category ? { genre: category.id, mood: category.moods[0], bpm: category.typicalBpm } : null,
          note: `Provider Not Connected: set one of ${requiredEnv.join(", ")} server-side to enable music_generation. The ranked plan below is ready to send.`,
        }),
      );
    }

    // ----- Connected: route the top pick through the orchestrator ------------
    const durationSeconds = typeof body.durationSeconds === "number" ? body.durationSeconds : undefined;
    const task: AiTask = {
      type: "MUSIC",
      capability: "music_generation",
      payload: {
        genre: category?.id ?? top.categoryId,
        mood: category?.moods[0] ?? undefined,
        bpm: category?.typicalBpm ?? undefined,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      },
      params: { format: "mp3", ...(durationSeconds !== undefined ? { durationSeconds } : {}) },
      metadata: { action: "select", topic: topic ?? null, top: top.categoryId, score: top.score },
    };
    const result = await execute(userId, task);
    if (result.status !== "ok") {
      const requiredEnv =
        result.requiredEnv && result.requiredEnv.length > 0 ? result.requiredEnv : requiredEnvFor("music_generation");
      return ok(
        asJsonSafe({
          connected: false,
          capability: "music_generation",
          requiredEnv,
          envHint: requiredEnv[0],
          availableCategories: MUSIC_CATEGORIES,
          ranked: ranking.ranked,
          top,
          note: `The music request could not complete: ${result.error ?? "unknown error"}. Nothing was fabricated.`,
        }),
      );
    }

    // Persist the REAL provider track as Music + Asset + LicensingMetadata.
    const provider = result.provider ?? null;
    const model = result.model ?? null;
    const output = (result.outputRefs ?? {}) as { audioUrl?: unknown };
    const audioUrl = typeof output.audioUrl === "string" ? output.audioUrl : null;
    const projectId =
      typeof body.projectId === "string" && body.projectId.trim()
        ? await prisma.project
            .findFirst({ where: { id: body.projectId.trim(), userId } })
            .then((p) => p?.id ?? null)
        : null;

    let asset: unknown = null;
    if (projectId) {
      asset = await prisma.$transaction(async (tx) => {
        const row = await tx.asset.create({
          data: {
            projectId,
            userId,
            kind: "MUSIC",
            name: `Music — ${category?.name ?? top.name}`,
            status: "READY",
            mimeType: "audio/mpeg",
            durationSeconds: durationSeconds ?? Math.max(1, Math.round((category?.typicalBpm ?? 90) / 30)),
            url: audioUrl ?? undefined,
            metadata: {
              music: { provider, model, genre: category?.id ?? null, mood: category?.moods[0] ?? null, bpm: category?.typicalBpm ?? null, score: top.score },
            },
          },
        });
        await tx.music.create({
          data: {
            assetId: row.id,
            provider,
            model,
            genre: category?.id ?? null,
            mood: category?.moods[0] ?? null,
            bpm: category?.typicalBpm ?? null,
            status: "SUCCEEDED",
          },
        });
        await tx.licensingMetadata.create({
          data: {
            assetId: row.id,
            licenseType: "GENERATED",
            source: "Cinematic AI Video Studio (AI generation)",
          },
        });
        return tx.asset.findUnique({ where: { id: row.id }, include: { music: true } });
      });
    }

    return ok(
      asJsonSafe({
        connected: true,
        action: "select",
        ranked: ranking.ranked,
        top,
        provider,
        model,
        audioUrl,
        asset,
        note: projectId
          ? "Track generated and persisted to the project library with licensing metadata."
          : "Track generated but no projectId was provided, so it was not persisted to a library.",
      }),
    );
  } catch (err) {
    return apiError(err);
  }
}