import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { capabilityEnvNames, capabilityStatus, execute, requiredEnvFor } from "@/lib/ai";
import type { AiTask } from "@/lib/ai";
import {
  autoSubtitleStyle,
  avoidRegions,
  buildSubtitles,
  findSubtitleStyle,
  SUBTITLE_SAFE_MARGINS,
  SUBTITLE_STYLES,
  toSrt,
  type Region,
  type SubtitlePlan,
  type SubtitleSegmentInput,
} from "@/lib/subtitles";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = ["generate", "styles"] as const;
type SubtitleAction = (typeof ALLOWED_ACTIONS)[number];

/**
 * Server-side env var NAMES (never values) that could enable
 * subtitle_generation. Derived from the provider env-key registry via the
 * capability→provider slot table — never a literal list, so every name is one
 * some code actually reads.
 */
const SUBTITLE_REQUIRED_ENV = capabilityEnvNames("subtitle_generation");

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseSegments(v: unknown): SubtitleSegmentInput[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out = v
    .map((raw) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const text = typeof s.text === "string" && s.text.trim() ? s.text.trim() : undefined;
      if (!text) return null;
      const entry: Record<string, unknown> = { text };
      if (typeof s.startMs === "number" && Number.isFinite(s.startMs)) entry.startMs = Math.round(s.startMs);
      if (typeof s.endMs === "number" && Number.isFinite(s.endMs)) entry.endMs = Math.round(s.endMs);
      if (typeof s.speakingRate === "number" && Number.isFinite(s.speakingRate)) entry.speakingRate = s.speakingRate;
      if (typeof s.pauseBeforeMs === "number" && Number.isFinite(s.pauseBeforeMs)) entry.pauseBeforeMs = Math.round(s.pauseBeforeMs);
      if (typeof s.pauseAfterMs === "number" && Number.isFinite(s.pauseAfterMs)) entry.pauseAfterMs = Math.round(s.pauseAfterMs);
      if (Array.isArray(s.emphasis)) entry.emphasis = s.emphasis.filter((e) => typeof e === "string");
      return entry;
    })
    .filter((e): e is Record<string, unknown> => e !== null);
  return out.length > 0 ? (out as SubtitleSegmentInput[]) : undefined;
}

function parseRegions(v: unknown): Region[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Region[] = [];
  for (const raw of v) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const label = str(r.label);
    if (!label || !["face", "text", "chart", "subject"].includes(label)) continue;
    const x = num(r.x);
    const y = num(r.y);
    const w = num(r.w);
    const h = num(r.h);
    if (x === undefined || y === undefined || w === undefined || h === undefined || w <= 0 || h <= 0) continue;
    out.push({ label: label as Region["label"], x, y, w, h });
  }
  return out.length > 0 ? out : undefined;
}

function asJsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:subtitles", 30);
    const body = (await readJson(req)) as Record<string, unknown>;
    const action = body.action as SubtitleAction | undefined;
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return ok(
        { connected: false, error: "Unknown action.", note: "Expected one of: " + ALLOWED_ACTIONS.join(", ") },
        400,
      );
    }

    // ----- styles: deterministic catalog + auto-choice --------------------------
    if (action === "styles") {
      return ok(
        asJsonSafe({
          connected: false,
          styles: SUBTITLE_STYLES,
          auto: autoSubtitleStyle({
            topic: str(body.topic),
            emotion: str(body.emotion),
            mood: str(body.mood),
            videoKind: str(body.videoKind),
          }),
        }),
      );
    }

    // ----- generate: deterministic plan + REAL SRT, provider for transcription --
    const text = str(body.text);
    const segments = parseSegments(body.segments);
    if (!text && !segments) {
      return ok(
        { connected: false, error: "Missing input.", note: 'Provide "text" (or "segments" carrying text) to generate subtitles.' },
        400,
      );
    }

    // Style: "auto" (default) resolves via autoSubtitleStyle; an explicit id is
    // validated against the 8-style catalog.
    const requestedStyle = str(body.style) ?? "auto";
    let chosenStyle: ReturnType<typeof autoSubtitleStyle>;
    let styleId = "minimal";
    if (requestedStyle !== "auto") {
      const found = findSubtitleStyle(requestedStyle);
      if (!found) {
        return ok(
          {
            connected: false,
            error: "Unknown style.",
            note: `Expected one of the catalog ids: ${SUBTITLE_STYLES.map((s) => s.id).join(", ")} (or "auto").`,
          },
          400,
        );
      }
      styleId = found.id;
      chosenStyle = { style: found, reason: "Explicit style selection." };
    } else {
      chosenStyle = autoSubtitleStyle({
        topic: str(body.topic),
        emotion: str(body.emotion),
        mood: str(body.mood),
        videoKind: str(body.videoKind),
      });
      styleId = chosenStyle.style.id;
    }

    const plan: SubtitlePlan = buildSubtitles({
      text,
      segments,
      language: str(body.language) ?? "en",
      style: styleId,
      ...(num(body.maxLineLength) !== undefined ? { maxLineLength: Math.round(num(body.maxLineLength)!) } : {}),
    });

    const regions = parseRegions(body.regions);
    const videoWidth = Math.round(num(body.videoWidth) ?? 1920);
    const videoHeight = Math.round(num(body.videoHeight) ?? 1080);
    const placements = avoidRegions({
      cueTexts: plan.cues.map((c) => c.text),
      regions,
      videoWidth,
      videoHeight,
    });
    const srt = toSrt(plan);

    const status = capabilityStatus("subtitle_generation");
    if (status.status !== "connected") {
      return ok(
        asJsonSafe({
          connected: false,
          action: "generate",
          capability: "subtitle_generation",
          requiredEnv: SUBTITLE_REQUIRED_ENV,
          envHint: SUBTITLE_REQUIRED_ENV[0],
          plan,
          chosenStyle,
          placements,
          format: { srt },
          safeMargins: SUBTITLE_SAFE_MARGINS,
          note: `Provider Not Connected: set one of ${SUBTITLE_REQUIRED_ENV.join(", ")} server-side to enable subtitle_generation. Caption text is fully generated by the deterministic engines in this build; audio→subtitle transcription is a provider-backed step and reports its own provider status. The SRT below is real and ready to use.`,
        }),
      );
    }

    // ----- Connected: route transcription through the orchestrator --------------
    const task: AiTask = {
      type: "SUBTITLE",
      capability: "subtitle_generation",
      payload: {
        ...(str(body.audioRef) ? { audioRef: str(body.audioRef) } : {}),
        ...(str(body.transcriptRef) ? { transcriptRef: str(body.transcriptRef) } : {}),
        language: str(body.language) ?? "en",
        format: "srt",
        maxLineLength: plan.maxLineLength,
      },
      params: { language: plan.language },
      metadata: {
        action: "generate",
        cueCount: plan.cues.length,
        style: styleId,
        deterministicSrtLength: srt.length,
      },
    };
    const result = await execute(userId, task);
    if (result.status !== "ok") {
      const requiredEnv =
        result.requiredEnv && result.requiredEnv.length > 0
          ? result.requiredEnv
          : requiredEnvFor("subtitle_generation");
      return ok(
        asJsonSafe({
          connected: false,
          capability: "subtitle_generation",
          // The orchestrator's own state, forwarded so a reached-and-rejected
          // attempt is never rendered as the unkeyed "no provider" state.
          status: result.status,
          attempts: result.attempts,
          requiredEnv,
          envHint: requiredEnv[0],
          plan,
          chosenStyle,
          placements,
          format: { srt },
          note: `The subtitle request could not complete: ${result.error ?? "unknown error"}. Nothing was fabricated.`,
        }),
      );
    }

    // Persist the provider's REAL subtitles as Subtitle + Asset (same transaction
    // pattern Blocks 1/2 use for voice / sound effects).
    const provider = result.provider ?? null;
    const model = result.model ?? null;
    const output = (result.outputRefs ?? {}) as { fileUrl?: unknown; srt?: unknown };
    const fileUrl = typeof output.fileUrl === "string" ? output.fileUrl : null;
    const providerSrt = typeof output.srt === "string" ? output.srt : srt;
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
            kind: "SUBTITLE",
            name: `Subtitles — ${plan.language} (${styleId})`,
            status: "READY",
            mimeType: "application/x-subrip",
            durationSeconds: Math.max(1, Math.round((plan.cues[plan.cues.length - 1]?.endMs ?? 0) / 1000)),
            url: fileUrl ?? undefined,
            metadata: { subtitles: { provider, model, style: styleId, cueCount: plan.cues.length } },
          },
        });
        await tx.subtitle.create({
          data: {
            assetId: row.id,
            language: plan.language,
            format: "SRT",
            text: providerSrt.slice(0, 120_000),
          },
        });
        await tx.licensingMetadata.create({
          data: {
            assetId: row.id,
            licenseType: "GENERATED",
            source: "Cinematic AI Video Studio (AI generation)",
          },
        });
        return tx.asset.findUnique({ where: { id: row.id }, include: { subtitle: true } });
      });
    }

    return ok(
      asJsonSafe({
        connected: true,
        action: "generate",
        plan,
        chosenStyle,
        placements,
        format: { srt: providerSrt },
        provider,
        model,
        asset,
        note: projectId
          ? "Subtitles generated and persisted to the project library."
          : "Subtitles generated but no projectId was provided, so they were not persisted to a library.",
      }),
    );
  } catch (err) {
    return apiError(err);
  }
}