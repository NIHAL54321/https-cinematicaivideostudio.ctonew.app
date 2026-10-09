import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { capabilityEnvNames, capabilityStatus, execute, requiredEnvFor } from "@/lib/ai";
import type { AiTask } from "@/lib/ai";
import {
  buildPronunciationLexicon,
  directVoice,
  findLanguage,
  findVoice,
  getVoiceRecommendation,
  listVoices,
  normalizeSpokenText,
  validatePronunciations,
  voicePersonas,
  wordToPhoneticHint,
  type Corrections,
} from "@/lib/voice";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = ["catalog", "direct", "pronounce"] as const;
type VoiceAction = (typeof ALLOWED_ACTIONS)[number];

/**
 * Server-side env var NAMES (never values) that could enable voice_generation.
 * Derived from the provider env-key registry via the capability→provider slot
 * table — never a literal list, so every name is one some code actually reads.
 */
const VOICE_REQUIRED_ENV = capabilityEnvNames("voice_generation");

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseCorrections(v: unknown): Corrections {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Corrections = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && k.trim() && val.trim()) out[k.trim()] = val.trim();
  }
  return out;
}

function asJsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:voice", 30);
    const body = (await readJson(req)) as Record<string, unknown>;
    const action = body.action as VoiceAction | undefined;
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return ok(
        { connected: false, error: "Unknown action.", note: "Expected one of: " + ALLOWED_ACTIONS.join(", ") },
        400,
      );
    }

    // ----- catalog: deterministic, no provider --------------------------------
    if (action === "catalog") {
      return ok({ connected: false, voices: listVoices(), personas: voicePersonas() });
    }

    // ----- pronounce: deterministic, no provider ------------------------------
    if (action === "pronounce") {
      const text = str(body.text);
      if (!text) {
        return ok({ connected: false, error: "Missing text.", note: 'Provide "text" to normalize.' }, 400);
      }
      const corrections = parseCorrections(body.corrections);
      // Lexicon blends text-derived phonetic hints with manual corrections
      // (corrections win inside buildPronunciationLexicon).
      const hintTokens = Array.from(
        new Set((text.match(/[A-Za-z][A-Za-z0-9&'’.-]*/g) ?? []).filter((t) => wordToPhoneticHint(t) !== null)),
      ).slice(0, 40);
      return ok(
        asJsonSafe({
          connected: false,
          spokenText: normalizeSpokenText(text, corrections),
          lexicon: buildPronunciationLexicon({ names: hintTokens, corrections }),
          issues: validatePronunciations(corrections),
        }),
      );
    }

    // ----- direct: deterministic plan + spoken text, provider dispatch --------
    const script = str(body.script);
    if (!script) {
      return ok({ connected: false, error: "Missing script.", note: 'Provide "script" to direct.' }, 400);
    }
    const language = str(body.language) ?? "en";
    const langEntry = findLanguage(language);
    const voice =
      findVoice(str(body.voiceId) ?? undefined) ??
      getVoiceRecommendation({ scriptTone: script.slice(0, 400) });
    const corrections = parseCorrections(body.corrections);

    const speakingRate =
      typeof body.speakingRate === "number" && Number.isFinite(body.speakingRate)
        ? Math.min(1.5, Math.max(0.5, body.speakingRate))
        : undefined;

    const plan = directVoice(script, {
      language,
      voiceId: voice.id,
      corrections,
      ...(speakingRate !== undefined ? { speakingRate } : {}),
    });
    const spokenText = normalizeSpokenText(script, corrections);

    const status = capabilityStatus("voice_generation");
    if (status.status !== "connected") {
      // Honest lane: name the two TTS provider keys (display names only).
      const requiredEnv = VOICE_REQUIRED_ENV;
      return ok(
        asJsonSafe({
          connected: false,
          capability: "voice_generation",
          requiredEnv,
          envHint: requiredEnv[0],
          plan,
          spokenText,
          voice,
          language: langEntry,
          estimatedDurationMs: plan.estimatedDurationMs,
          note: `Provider Not Connected: set one of ${requiredEnv.join(", ")} server-side to enable voice_generation. The full directed request below is ready to send.`,
        }),
      );
    }

    // ----- Connected: route the real spoken text through the orchestrator -----
    const task: AiTask = {
      type: "VOICE",
      capability: "voice_generation",
      payload: { text: spokenText },
      params: { language },
      metadata: {
        action: "direct",
        voiceId: voice.id,
        plan: { energy: plan.energy, estimatedDurationMs: plan.estimatedDurationMs },
      },
    };
    const result = await execute(userId, task);
    if (result.status !== "ok") {
      const requiredEnv =
        result.requiredEnv && result.requiredEnv.length > 0
          ? result.requiredEnv
          : requiredEnvFor("voice_generation");
      return ok(
        asJsonSafe({
          connected: false,
          capability: "voice_generation",
          // The orchestrator's own state, forwarded so a reached-and-rejected
          // attempt is never rendered as the unkeyed "no provider" state.
          status: result.status,
          attempts: result.attempts,
          requiredEnv,
          envHint: requiredEnv[0],
          plan,
          spokenText,
          voice,
          estimatedDurationMs: plan.estimatedDurationMs,
          note: `The voice request could not complete: ${result.error ?? "unknown error"}. Nothing was fabricated.`,
        }),
      );
    }

    // Persist the REAL provider voiceover as Voiceover + Asset + provider log.
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
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.asset.create({
          data: {
            projectId,
            userId,
            kind: "VOICEOVER",
            name: `Voiceover — ${voice.name}`,
            status: "READY",
            mimeType: "audio/mpeg",
            durationSeconds: Math.max(1, Math.round(plan.estimatedDurationMs / 1000)),
            url: audioUrl ?? undefined,
            metadata: {
              voiceover: { provider, model, voiceId: voice.id, language, text: spokenText.slice(0, 4000) },
            },
          },
        });
        await tx.voiceover.create({
          data: {
            assetId: row.id,
            provider,
            model,
            voiceId: voice.id,
            text: spokenText.slice(0, 8000),
            language,
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
        return tx.asset.findUnique({ where: { id: row.id }, include: { voiceover: true } });
      });
      asset = created;
    }

    return ok(
      asJsonSafe({
        connected: true,
        action: "direct",
        plan,
        spokenText,
        voice,
        estimatedDurationMs: plan.estimatedDurationMs,
        provider,
        model,
        audioUrl,
        asset,
        note: projectId
          ? "Voiceover generated and persisted to the project library."
          : "Voiceover generated but no projectId was provided, so it was not persisted to a library.",
      }),
    );
  } catch (err) {
    return apiError(err);
  }
}
