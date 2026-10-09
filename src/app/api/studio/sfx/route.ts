import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { capabilityEnvNames, capabilityStatus, execute, requiredEnvFor } from "@/lib/ai";
import type { AiTask } from "@/lib/ai";
import { SFX_LIBRARY, placementPolicy, planSoundEffects, type ScenePlanInput } from "@/lib/sfx";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = ["plan"] as const;
type SfxAction = (typeof ALLOWED_ACTIONS)[number];

/**
 * Server-side env var NAMES (never values) that could enable sound_effects.
 * Derived from the provider env-key registry via the capability→provider slot
 * table — never a literal list, so every name is one some code actually reads.
 */
const SFX_REQUIRED_ENV = capabilityEnvNames("sound_effects");

function asJsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:sfx", 30);
    const body = (await readJson(req)) as Record<string, unknown>;
    const action = body.action as SfxAction | undefined;
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return ok(
        { connected: false, error: "Unknown action.", note: "Expected one of: " + ALLOWED_ACTIONS.join(", ") },
        400,
      );
    }

    // ----- plan: deterministic sparse SFX schedule ----------------------------
    const rawScenes = Array.isArray(body.scenes) ? (body.scenes as unknown[]) : null;
    if (!rawScenes || rawScenes.length === 0) {
      return ok(
        {
          connected: false,
          error: "Missing scenes.",
          note: 'Provide "scenes" as an array of { text, durationMs?, transitionType? }.',
        },
        400,
      );
    }
    const scenes: ScenePlanInput[] = rawScenes.map((raw, i) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const text = typeof s.text === "string" ? s.text : "";
      const durationMs = typeof s.durationMs === "number" && Number.isFinite(s.durationMs) ? s.durationMs : undefined;
      const transitionType = typeof s.transitionType === "string" && s.transitionType.trim() ? s.transitionType.trim() : undefined;
      return {
        sceneId: typeof s.sceneId === "string" && s.sceneId.trim() ? s.sceneId.trim() : undefined,
        text,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(transitionType !== undefined ? { transitionType } : {}),
      };
    });
    const tone = typeof body.tone === "string" && body.tone.trim() ? body.tone.trim() : undefined;
    // Drop scenes with no text so they can't pollute the schedule.
    const validScenes = scenes.filter((s) => s.text.trim().length > 0);

    const plan = planSoundEffects({ scenes: validScenes, tone });
    const status = capabilityStatus("sound_effects");
    if (status.status !== "connected") {
      const requiredEnv = SFX_REQUIRED_ENV;
      return ok(
        asJsonSafe({
          connected: false,
          action: "plan",
          capability: "sound_effects",
          requiredEnv,
          envHint: requiredEnv[0],
          library: SFX_LIBRARY,
          schedule: plan.schedule,
          policy: plan.policy,
          note: `Provider Not Connected: set one of ${requiredEnv.join(", ")} server-side to enable sound_effects. The schedule below is ready to send.`,
        }),
      );
    }

    // ----- Connected: route the schedule through the orchestrator -------------
    const description = validScenes.map((s) => s.text.trim()).join(" ").slice(0, 4000);
    const totalSeconds = validScenes.reduce((sum, s) => sum + (s.durationMs ?? 4000), 0) / 1000;
    const task: AiTask = {
      type: "SOUND_EFFECT",
      capability: "sound_effects",
      payload: {
        description: description || "Sound effects for the planned scenes.",
        ...(plan.schedule.length > 0 ? { intensity: "subtle" as const } : {}),
      },
      params: { format: "wav", durationSeconds: Math.max(1, Math.round(totalSeconds)) },
      metadata: { action: "plan", sceneCount: validScenes.length, scheduled: plan.schedule.length },
    };
    const result = await execute(userId, task);
    if (result.status !== "ok") {
      const requiredEnv =
        result.requiredEnv && result.requiredEnv.length > 0 ? result.requiredEnv : requiredEnvFor("sound_effects");
      return ok(
        asJsonSafe({
          connected: false,
          capability: "sound_effects",
          // The orchestrator's own state, forwarded so a reached-and-rejected
          // attempt is never rendered as the unkeyed "no provider" state.
          status: result.status,
          attempts: result.attempts,
          requiredEnv,
          envHint: requiredEnv[0],
          schedule: plan.schedule,
          policy: plan.policy,
          note: `The sound-effects request could not complete: ${result.error ?? "unknown error"}. Nothing was fabricated.`,
        }),
      );
    }

    // Persist the REAL provider effects as SoundEffect + Asset + LicensingMetadata.
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
            kind: "SOUND_EFFECT",
            name: `Sound effects — ${plan.schedule.length} hit${plan.schedule.length === 1 ? "" : "s"}`,
            status: "READY",
            mimeType: "audio/wav",
            durationSeconds: Math.max(1, Math.round(totalSeconds)),
            url: audioUrl ?? undefined,
            metadata: { soundFX: { provider, model, count: plan.schedule.length } },
          },
        });
        await tx.soundEffect.create({
          data: {
            assetId: row.id,
            provider,
            model,
            description: description.slice(0, 8000),
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
        return tx.asset.findUnique({ where: { id: row.id }, include: { soundEffect: true } });
      });
    }

    return ok(
      asJsonSafe({
        connected: true,
        action: "plan",
        schedule: plan.schedule,
        policy: plan.policy,
        provider,
        model,
        audioUrl,
        asset,
        note: projectId
          ? "Sound effects generated and persisted to the project library with licensing metadata."
          : "Sound effects generated but no projectId was provided, so they were not persisted to a library.",
      }),
    );
  } catch (err) {
    return apiError(err);
  }
}