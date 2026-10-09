/**
 * Phase 2 pipeline — the server-side flow that connects the pure studio
 * engines (src/lib/studio/*) to Prisma and the AI Model Orchestrator.
 *
 * This file is SERVER-ONLY. It persists REAL structure (Script/Chapter/Scene
 * rows with durations and template visual prompts) and then attempts ONE AI
 * step through the orchestrator. Because no provider is wired in Phase 1,
 * that attempt honestly returns "Provider Not Connected" — the wizard stops
 * there and never fakes the remaining steps.
 */
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { execute, type AiResult } from "@/lib/ai";
import { createVersion, getOwnedProject, getProjectDetail } from "@/lib/projects";
import type { ProjectDetail } from "@/lib/projects";
import { buildPlan, validateDurationForFormat } from "./budgeting";
import { selectStructure } from "./structures";
import { decideSceneMedia } from "./scene-intelligence";
import { pickCamera } from "./cameras";
import { selectDescriptors } from "./cinematic";
import { defaultScenePrompt } from "./visual-prompts";
import { FORMAT_ASPECT_RATIO, INPUT_TYPES, type InputType, type VideoFormat, type VideoPlan } from "./types";
import { Prisma } from "@prisma/client";

/** Format → orchestrator videoType vocabulary. */
function videoTypeFor(format: VideoFormat | null | undefined): "longform" | "shorts" | "clip" {
  return format === "LONG" ? "longform" : format === "SHORT" ? "shorts" : "clip";
}

// ---------------------------------------------------------------------------
// Input parsing & validation
// ---------------------------------------------------------------------------

export interface CreateVideoInput {
  title?: string;
  inputType: InputType;
  sourceText: string;
  format: VideoFormat;
  durationSeconds: number;
  style: string;
  language: string;
  voice: string;
}

const MAX_SOURCE = 20_000;
const MAX_TITLE = 120;

/** Validates + normalizes the wizard's CREATE payload. Throws 400 on bad input. */
export function parseCreateVideoInput(body: unknown): CreateVideoInput {
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "Request body must be an object.", "bad_input");
  }
  const raw = body as Record<string, unknown>;
  const rawInputType = raw.inputType;
  if (typeof rawInputType !== "string" || !(INPUT_TYPES as readonly string[]).includes(rawInputType)) {
    throw new ApiError(400, "inputType must be one of IDEA, SCRIPT, ARTICLE, URL, DOCUMENT.", "bad_input");
  }
  const inputType = rawInputType as InputType;
  const sourceText = typeof raw.sourceText === "string" ? raw.sourceText.trim() : "";
  if (sourceText.length < 3) {
    throw new ApiError(400, "Tell us what you want to create (at least 3 characters).", "bad_input");
  }
  if (sourceText.length > MAX_SOURCE) {
    throw new ApiError(400, `Source text is too long (max ${MAX_SOURCE} characters).`, "bad_input");
  }
  const format = raw.format;
  if (format !== "LONG" && format !== "SHORT" && format !== "SOCIAL") {
    throw new ApiError(400, "format must be LONG, SHORT or SOCIAL.", "bad_input");
  }
  const durationSeconds = raw.durationSeconds;
  if (typeof durationSeconds !== "number" || !Number.isInteger(durationSeconds)) {
    throw new ApiError(400, "durationSeconds must be a whole number.", "bad_input");
  }
  const rangeCheck = validateDurationForFormat(durationSeconds, format);
  if (!rangeCheck.ok) {
    throw new ApiError(400, rangeCheck.error, "bad_duration");
  }
  const style = typeof raw.style === "string" ? raw.style.trim().slice(0, 100) : "";
  if (!style) throw new ApiError(400, "style is required.", "bad_input");
  const language = typeof raw.language === "string" ? raw.language.trim().slice(0, 10) : "";
  if (!language) throw new ApiError(400, "language is required.", "bad_input");
  const voice = typeof raw.voice === "string" ? raw.voice.trim().slice(0, 100) : "";
  if (!voice) throw new ApiError(400, "voice is required.", "bad_input");
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE) : "";
  return { title, inputType, sourceText, format, durationSeconds, style, language, voice };
}

// ---------------------------------------------------------------------------
// Magic create pipeline
// ---------------------------------------------------------------------------

export type PipelineStepId =
  | "analyze"
  | "structure"
  | "script"
  | "storyboard"
  | "visuals"
  | "voice"
  | "music"
  | "export";

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: "done" | "blocked" | "pending";
  detail?: string;
}

export interface MagicCreateResult {
  project: ProjectDetail;
  plan: VideoPlan | null;
  steps: PipelineStep[];
  /** Present exactly when an AI step stopped the pipeline. */
  blocked: {
    capability: string;
    requiredEnv: string[];
    error: string;
  } | null;
}

function scriptTaskFor(input: CreateVideoInput, structureName: string) {
  return {
    type: "SCRIPT" as const,
    capability: "script_generation" as const,
    payload: {
      prompt: input.sourceText,
      structure: structureName,
      videoType: videoTypeFor(input.format),
    },
    params: {
      language: input.language,
      durationSeconds: input.durationSeconds,
      aspectRatio: FORMAT_ASPECT_RATIO[input.format].replace("_", ":"),
      videoType: videoTypeFor(input.format),
      tone: input.style,
    },
  };
}

/**
 * Full wizard flow: analyze → structure (REAL, deterministic) → script (AI).
 * The project, settings and structure plan are persisted BEFORE the AI step,
 * so the honest stop still leaves a real, openable project behind.
 */
export async function magicCreate(userId: string, input: CreateVideoInput): Promise<MagicCreateResult> {
  // --- Step 1: analyze (REAL) ---------------------------------------------
  const selection = selectStructure(input.format, input.sourceText);
  const structure = selection.structure;

  // --- Step 2: build + enrich the structure plan (REAL) --------------------
  const plan = buildPlan({
    durationSeconds: input.durationSeconds,
    format: input.format,
    structureId: structure.id,
    topic: input.sourceText,
  });
  // Deterministic per-scene media/camera/prompt enrichment (structure, not AI).
  for (const chapter of plan.chapters) {
    for (const scene of chapter.scenes) {
      const media = decideSceneMedia({
        beatId: scene.beatId,
        beatName: scene.beatName,
        sceneTitle: scene.title,
        topic: input.sourceText,
        format: input.format,
        style: input.style,
      });
      const camera = pickCamera({
        beatId: scene.beatId,
        beatName: scene.beatName,
        mediaType: media.mediaType,
        format: input.format,
      });
      const descriptors = selectDescriptors({
        tone: input.style,
        mediaType: media.mediaType,
        format: input.format,
      });
      scene.mediaType = media.mediaType;
      scene.camera = camera.shot.name;
      scene.visualPrompt = defaultScenePrompt({
        topic: input.sourceText,
        beatName: scene.beatName,
        camera: camera.shot,
        mediaType: media.mediaType,
        format: input.format,
        descriptors,
        durationSeconds: scene.durationSeconds,
      });
    }
  }

  // --- Persist: project + settings + script tree (REAL) --------------------
  const title = input.title || (input.sourceText.length > 80 ? `${input.sourceText.slice(0, 77)}…` : input.sourceText);
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        userId,
        title,
        description: input.sourceText.slice(0, 2000),
        status: "PLANNING",
        targetAspectRatio: FORMAT_ASPECT_RATIO[input.format],
        targetDurationSeconds: input.durationSeconds,
        settings: {
          create: {
            defaultAspectRatio: FORMAT_ASPECT_RATIO[input.format],
            language: input.language,
            tone: null,
            style: input.style,
            voiceoverDefaults: { voiceId: input.voice, model: "preset", language: input.language },
            subtitleDefaults: { enabled: false },
            extra: {
              inputType: input.inputType,
              sourceText: input.sourceText,
              format: input.format,
              voice: input.voice,
              style: input.style,
              structureId: structure.id,
              structureName: structure.name,
              structurePlan: plan,
              structurePlanSource: "structure-template", // transparency label
              createdVia: "create-video-wizard",
            } as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });
    const script = await tx.script.create({
      data: {
        projectId: created.id,
        title,
        language: input.language,
        tone: null,
        style: input.style,
      },
    });
    for (const chapter of plan.chapters) {
      const ch = await tx.chapter.create({
        data: {
          scriptId: script.id,
          projectId: created.id,
          title: chapter.title,
          order: chapter.order,
          summary: chapter.summary,
        },
      });
      for (const scene of chapter.scenes) {
        await tx.scene.create({
          data: {
            chapterId: ch.id,
            projectId: created.id,
            order: scene.order,
            title: scene.title,
            narration: null, // ALWAYS null: AI territory, so this engine produces no narration value
            visualPrompt: scene.visualPrompt,
            aspectRatio: FORMAT_ASPECT_RATIO[input.format],
            durationSeconds: scene.durationSeconds,
            status: "DRAFT",
          },
        });
      }
    }
    return created;
  });
  await createVersion(project.id, "Created via the Create Video wizard (structure plan persisted)", userId);

  // --- Step 3: script generation (AI → honest stop) ------------------------
  const aiResult: AiResult = await execute(userId, scriptTaskFor(input, structure.name));

  const done: PipelineStep[] = [
    {
      id: "analyze",
      label: "Analyzing your idea…",
      status: "done",
      detail:
        selection.matchedKeywords.length > 0
          ? `Structure selected: ${structure.name} (keywords: ${selection.matchedKeywords.join(", ")})`
          : `Structure selected: ${structure.name}`,
    },
    {
      id: "structure",
      label: "Building the structure plan…",
      status: "done",
      detail: `${plan.chapterCount} chapters · ${plan.sceneCount} scenes · ${plan.totalDurationSeconds}s total · hook beat ${plan.hookSeconds}s`,
    },
  ];

  if (aiResult.status === "ok") {
    // A real provider answered (not possible in Phase 1) — continue honestly.
    return {
      project: await getProjectDetail(userId, project.id),
      plan,
      steps: [
        ...done,
        { id: "script", label: "Writing the script…", status: "done", detail: "Script generated by a connected provider." },
        { id: "storyboard", label: "Creating storyboard…", status: "pending" },
        { id: "visuals", label: "Finding cinematic visuals…", status: "pending" },
        { id: "voice", label: "Recording voiceover…", status: "pending" },
        { id: "music", label: "Composing music…", status: "pending" },
        { id: "export", label: "Rendering final video…", status: "pending" },
      ],
      blocked: null,
    };
  }

  const blocked = {
    capability: aiResult.capability,
    requiredEnv: aiResult.requiredEnv ?? [],
    error: aiResult.error ?? "Provider Not Connected.",
  };
  return {
    project: await getProjectDetail(userId, project.id),
    plan,
    steps: [
      ...done,
      { id: "script", label: "Writing the script…", status: "blocked", detail: blocked.error },
      { id: "storyboard", label: "Creating storyboard…", status: "pending", detail: "Awaiting script generation." },
      { id: "visuals", label: "Finding cinematic visuals…", status: "pending", detail: "Awaiting storyboard." },
      { id: "voice", label: "Recording voiceover…", status: "pending", detail: "Awaiting script." },
      { id: "music", label: "Composing music…", status: "pending", detail: "Awaiting script." },
      { id: "export", label: "Rendering final video…", status: "pending", detail: "Awaiting prior phases." },
    ],
    blocked,
  };
}

// ---------------------------------------------------------------------------
// Script tree (workspace Script tab)
// ---------------------------------------------------------------------------

export type ScriptTreeScene = {
  id: string;
  order: number;
  title: string | null;
  durationSeconds: number | null;
  narration: string | null;
  visualPrompt: string | null;
  status: string;
  /** Storyboard enrichment — from the persisted structure plan (per-scene). */
  mediaType: string | null;
  camera: string | null;
  clips: number[] | null;
};

export type ScriptTreeChapter = {
  id: string;
  order: number;
  title: string;
  summary: string | null;
  scenes: ScriptTreeScene[];
};

export type ScriptTree = {
  script: {
    id: string;
    title: string | null;
    language: string | null;
    style: string | null;
    chapters: ScriptTreeChapter[];
  } | null;
  meta: {
    sourceText: string | null;
    inputType: string | null;
    format: string | null;
    voice: string | null;
    style: string | null;
    structureName: string | null;
    structureId: string | null;
    structurePlan: unknown;
    totalDurationSeconds: number | null;
    /** Project-level storyboard context (real persisted values, else null). */
    targetDurationSeconds: number | null;
    musicMood: string | null;
    subtitleEnabled: boolean | null;
  } | null;
};

/** Enrichment lookup: plan chapter:scene order → plan scene (structure data). */
function planSceneByKey(plan: unknown): Map<string, { mediaType?: string; camera?: string; clips?: number[]; beatName?: string }> {
  const map = new Map<string, { mediaType?: string; camera?: string; clips?: number[]; beatName?: string }>();
  if (typeof plan !== "object" || plan === null) return map;
  const chapters = (plan as { chapters?: unknown }).chapters;
  if (!Array.isArray(chapters)) return map;
  for (const ch of chapters) {
    if (typeof ch !== "object" || ch === null) continue;
    const chOrder = (ch as { order?: unknown }).order;
    const scenes = (ch as { scenes?: unknown }).scenes;
    if (typeof chOrder !== "number" || !Array.isArray(scenes)) continue;
    for (const sc of scenes) {
      if (typeof sc !== "object" || sc === null) continue;
      const s = sc as { order?: unknown; mediaType?: unknown; camera?: unknown; clips?: unknown; beatName?: unknown };
      if (typeof s.order !== "number") continue;
      map.set(`${chOrder}:${s.order}`, {
        mediaType: typeof s.mediaType === "string" ? s.mediaType : undefined,
        camera: typeof s.camera === "string" ? s.camera : undefined,
        clips: Array.isArray(s.clips) ? s.clips.filter((c): c is number => typeof c === "number") : undefined,
        beatName: typeof s.beatName === "string" ? s.beatName : undefined,
      });
    }
  }
  return map;
}

/** Tenant-scoped script tree for the workspace Script tab. */
export async function getScriptTree(userId: string, projectId: string): Promise<ScriptTree> {
  const project = await getOwnedProject(userId, projectId);
  const [script, settings] = await Promise.all([
    prisma.script.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: {
        chapters: {
          orderBy: { order: "asc" },
          include: {
            scenes: { orderBy: { order: "asc" }, select: {
              id: true, order: true, title: true, durationSeconds: true,
              narration: true, visualPrompt: true, status: true,
            } },
          },
        },
      },
    }),
    prisma.projectSettings.findUnique({ where: { projectId } }),
  ]);

  const extra = (settings?.extra ?? null) as Record<string, unknown> | null;
  const structurePlan = extra?.structurePlan ?? null;
  const totalDurationSeconds =
    typeof structurePlan === "object" && structurePlan !== null
      ? ((structurePlan as { totalDurationSeconds?: unknown }).totalDurationSeconds as number | undefined) ??
        null
      : null;

  const planScenes = planSceneByKey(structurePlan);
  const musicDefaults =
    settings?.musicDefaults && typeof settings.musicDefaults === "object" && settings.musicDefaults !== null
      ? (settings.musicDefaults as { mood?: unknown })
      : null;
  const subtitleDefaults =
    settings?.subtitleDefaults && typeof settings.subtitleDefaults === "object" && settings.subtitleDefaults !== null
      ? (settings.subtitleDefaults as { enabled?: unknown })
      : null;

  return {
    script: script
      ? {
          id: script.id,
          title: script.title,
          language: script.language,
          style: script.style,
          chapters: script.chapters.map((c) => ({
            id: c.id,
            order: c.order,
            title: c.title,
            summary: c.summary,
            scenes: c.scenes.map((s) => {
              const planScene = planScenes.get(`${c.order}:${s.order}`);
              return {
                id: s.id,
                order: s.order,
                title: s.title,
                durationSeconds: s.durationSeconds,
                narration: s.narration,
                visualPrompt: s.visualPrompt,
                status: s.status,
                mediaType: planScene?.mediaType ?? null,
                camera: planScene?.camera ?? null,
                clips: planScene?.clips ?? null,
              };
            }),
          })),
        }
      : null,
    meta: {
      sourceText: typeof extra?.sourceText === "string" ? extra.sourceText : null,
      inputType: typeof extra?.inputType === "string" ? extra.inputType : null,
      format: typeof extra?.format === "string" ? extra.format : null,
      voice: typeof extra?.voice === "string" ? extra.voice : null,
      style: typeof extra?.style === "string" ? extra.style : null,
      structureName: typeof extra?.structureName === "string" ? extra.structureName : null,
      structureId: typeof extra?.structureId === "string" ? extra.structureId : null,
      structurePlan,
      totalDurationSeconds,
      targetDurationSeconds: project.targetDurationSeconds,
      musicMood: typeof musicDefaults?.mood === "string" ? musicDefaults.mood : null,
      subtitleEnabled: subtitleDefaults?.enabled === true ? true : subtitleDefaults !== null ? false : null,
    },
  };
}

// ---------------------------------------------------------------------------
// AI actions from the workspace (honest not_connected in Phase 1)
// ---------------------------------------------------------------------------

export async function generateScript(userId: string, projectId: string): Promise<AiResult> {
  const project = await getOwnedProject(userId, projectId);
  const tree = await getScriptTree(userId, projectId);
  const sourceText = tree.meta?.sourceText ?? project.description ?? project.title;
  const structureName = tree.meta?.structureName ?? "chosen structure";
  const format = (tree.meta?.format as VideoFormat | null) ?? "LONG";
  const durationSeconds = tree.meta?.totalDurationSeconds ?? project.targetDurationSeconds ?? 300;
  return execute(userId, {
    type: "SCRIPT",
    capability: "script_generation",
    projectId,
    payload: {
      prompt: sourceText,
      structure: structureName,
      chapters: tree.script?.chapters.map((c) => ({ title: c.title, summary: c.summary })),
    },
    params: {
      language: tree.script?.language ?? "en",
      durationSeconds,
      videoType: videoTypeFor(format),
      aspectRatio: FORMAT_ASPECT_RATIO[format].replace("_", ":"),
    },
  });
}

// ---------------------------------------------------------------------------
// Standalone AI Script Writer actions (honest not_connected in Phase 1)
// ---------------------------------------------------------------------------

export type ScriptWriterIntelligenceAction =
  | "improve"
  | "engaging"
  | "emotional"
  | "concise"
  | "professional"
  | "retention";

export interface ScriptWriterAiInput {
  topic: string;
  tone?: string;
  videoType?: string; // orchestrator vocabulary: longform | shorts | clip
  durationSeconds?: number;
  /** The deterministic outline text the improvement should apply to. */
  outline?: string;
}

const INTELLIGENCE_DIRECTIVES: Record<ScriptWriterIntelligenceAction, string> = {
  improve: "Improve the overall script — tighten the prose and strengthen pacing.",
  engaging: "Make the script more engaging — add energy, momentum and attention hooks.",
  emotional: "Make the script more emotional — deepen human stakes and felt experience.",
  concise: "Make the script more concise — cut fluff, shorten sentences and keep the point.",
  professional: "Make the script more professional — polish tone, clarity and credibility.",
  retention: "Increase retention — add pattern interrupts, curiosity loops and stronger payoff pacing.",
};

/** "Generate Hook (AI)" for the standalone studio — routes through the orchestrator. */
export async function scriptWriterAiHook(userId: string, input: ScriptWriterAiInput): Promise<AiResult> {
  const topic = (input.topic || "").slice(0, 1000);
  return execute(userId, {
    type: "REASON",
    capability: "reasoning",
    payload: {
      prompt: `Generate 8 distinct hook options for a video about: ${topic}`,
      mode: "hooks",
    },
    params: {
      tone: input.tone ?? "cinematic",
      videoType: (input.videoType as "longform" | "shorts" | "clip" | undefined) ?? "longform",
    },
  });
}

/** Script Intelligence actions for the standalone studio — routes through the orchestrator. */
export async function scriptWriterIntelligence(
  userId: string,
  action: ScriptWriterIntelligenceAction,
  input: ScriptWriterAiInput,
): Promise<AiResult> {
  const topic = (input.topic || "<untitled>").slice(0, 1000);
  const outline = (input.outline || "").slice(0, 4000);
  return execute(userId, {
    type: "SCRIPT",
    capability: "script_generation",
    payload: {
      prompt: `${INTELLIGENCE_DIRECTIVES[action]} Original idea: ${topic}`,
      structure: "user-supplied outline",
      chapters: outline ? [{ title: "Outline", summary: outline }] : [],
    },
    params: {
      tone: input.tone ?? "cinematic",
      videoType: (input.videoType as "longform" | "shorts" | "clip" | undefined) ?? "longform",
      durationSeconds: input.durationSeconds,
    },
  });
}

export async function generateHook(userId: string, projectId: string): Promise<AiResult> {
  const project = await getOwnedProject(userId, projectId);
  const tree = await getScriptTree(userId, projectId);
  const topic = tree.meta?.sourceText ?? project.title;
  return execute(userId, {
    type: "REASON",
    capability: "reasoning",
    projectId,
    payload: {
      prompt: `Generate 8 hook options for a video about: ${topic.slice(0, 1000)}`,
      mode: "hooks",
    },
    params: {
      tone: tree.meta?.style ?? "cinematic",
      videoType: videoTypeFor(tree.meta?.format as VideoFormat | null),
    },
  });
}
