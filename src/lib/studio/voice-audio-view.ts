/**
 * The Voice & Audio tab's payload — the catalogue, the plans, and what the
 * delivered file's audio track actually is.
 * Phase 8 Audio/Subtitle/Thumbnail block, Block B, 2026-11-15.
 *
 * WHY THIS MODULE EXISTS
 * The tab used to be a blank that sent the reader to `/voice-studio` — a page the
 * served build answers 404. It now has a panel, and every number on it is read
 * from a row or produced by an engine, never typed in the component:
 *
 *   - the CATALOGUE is `listVoices()` / `voicePersonas()` — the same 15-persona
 *     catalog the `voice` `catalog` API action returns. Every entry records
 *     `providerVoiceId: null`, and the panel prints the count of those nulls
 *     beside the catalogue rather than a sentence about it;
 *   - the ENV VAR the panel names comes from `capabilityStatus("voice_generation")`
 *     — i.e. from the provider registry via `capabilityEnvPath`, so it is a name
 *     some code actually reads. Nothing here invents an env var;
 *   - the MUSIC pick is `selectMusic()` over this project's own title and
 *     description; the DUCKING schedule is `buildDuckingSchedule()` over the
 *     `directVoice()` plan of this project's own scene narration; the SFX
 *     schedule is `planSoundEffects()` over the same scenes. All three are the
 *     engines the `music` and `sfx` API actions call, and all three are PLANS:
 *     they describe audio that does not exist;
 *   - the DELIVERED FILE's audio track is read from the job's own
 *     `container-mux` stage output (`ffprobe` read-back) through
 *     `loadDeliveredVideoRows` — the same rows the download centre reads, under
 *     the same tenancy and synthetic-exclusion rule. A row that recorded no
 *     measurement produces a sentence saying so, never a default.
 *
 * WHAT IT SAYS PLAINLY
 * No text-to-speech provider is wired, so no narration can be produced on this
 * deployment, and no narration, music or sound effect is in any delivered file.
 * Both sentences are built here from the rows/payloads above and printed
 * verbatim by the component.
 *
 * Server-side only (it reads Prisma). The component imports the DTO types with
 * `import type`, so nothing in this file reaches the browser bundle.
 */
import { ApiError } from "@/lib/api";
import { capabilityStatus } from "@/lib/ai";
import {
  buildDuckingSchedule,
  findMusicCategory,
  selectMusic,
  type DuckingEvent,
  type DuckingMix,
  type RankedCategory,
} from "@/lib/music";
import { planSoundEffects, type PlacementPolicy, type SfxScheduledEvent } from "@/lib/sfx";
import { directVoice, getVoiceRecommendation, listVoices, voicePersonas, type VoiceEntry } from "@/lib/voice";
import { loadDeliveredVideoRows, type DeliveredVideoRow } from "@/lib/render/production-state";
import { projectSceneSource } from "@/lib/subtitles/scene-source";
import type { SceneSource } from "@/lib/subtitles/from-scenes";
import { prisma } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* The payload                                                         */
/* ------------------------------------------------------------------ */

/** One provider slot serving the capability, with what it needs (names only). */
export interface VoiceProviderRow {
  id: string;
  name: string;
  configured: boolean;
  wired: boolean;
}

/** The capability's own state, as the AI status module derives it. */
export interface VoiceProviderFacts {
  capability: string;
  /** True only when a serving slot is configured AND wired. */
  connected: boolean;
  status: string;
  /** Env var NAMES (never values) that would enable the capability. */
  requiredEnv: string[];
  /** The registry's own summary sentence. */
  envNote: string;
  providers: VoiceProviderRow[];
}

export interface VoiceCatalogueRow {
  id: string;
  name: string;
  persona: string;
  gender: string;
  accent: string;
  tone: string;
  description: string;
  providerVoiceId: string | null;
  capabilities: string[];
}

export interface MusicPlanView {
  /** The project text the ranking was run over. */
  topic: string;
  top: RankedCategory;
  ranked: RankedCategory[];
  category: { name: string; moods: string[]; typicalBpm: number; useHint: string } | null;
}

export interface DuckingPlanView {
  timingModel: string;
  /** Where music would be lowered, from the director plan's own estimated timing. */
  events: DuckingEvent[];
  mix: DuckingMix;
  /** The voice the director would direct this narration to (its own heuristic). */
  voiceId: string;
  voiceName: string;
  estimatedDurationMs: number;
  /** Scenes whose narration fed the plan. */
  scenesUsed: number;
}

export interface SfxPlanView {
  timingModel: string;
  policy: PlacementPolicy;
  events: SfxScheduledEvent[];
}

export interface DeliveredAudioView {
  jobId: string;
  presetId: string;
  presetLabel: string;
  bytes: number;
  sha256: string;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRateHz: number | null;
  measuredBy: string | null;
  /** The stage row's own statement of what the file does not contain. */
  absentNarration: string | null;
  absentMusic: string | null;
  absentSubtitles: string | null;
}

export interface VoiceAudioView {
  kind: "voice_audio";
  projectId: string;
  projectTitle: string;
  catalogue: {
    voices: VoiceCatalogueRow[];
    count: number;
    personas: string[];
    /** How many catalogue entries carry no provider-side voice id. */
    providerVoiceIdNullCount: number;
    /** The sentence the panel prints above the catalogue. Built from the two counts + env names. */
    sentence: string;
  };
  provider: VoiceProviderFacts;
  /** True when a Voiceover row exists for this project (a real, provider-produced narration). */
  voiceoverRows: number;
  plans: {
    /** The sentence the panel prints above the plans. */
    sentence: string;
    music: MusicPlanView;
    ducking: DuckingPlanView | null;
    /** Why there is no ducking schedule, or null when there is one. */
    duckingMissingReason: string | null;
    sfx: SfxPlanView | null;
    sfxMissingReason: string | null;
    sceneCount: number;
    scenesWithNarration: number;
  };
  delivered: {
    exists: boolean;
    files: DeliveredAudioView[];
    /** The sentence the panel prints about the delivered file's audio. Built from the rows. */
    sentence: string;
  };
  note: string;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function envPhrase(names: readonly string[]): string {
  if (names.length === 0) return "no env var (no provider slot serves the capability)";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ------------------------------------------------------------------ */
/* The derivation — pure, over rows and payloads                       */
/* ------------------------------------------------------------------ */

export interface VoiceAudioInput {
  projectId: string;
  projectTitle: string;
  projectDescription: string | null;
  scenes: SceneSource[];
  voiceoverRows: number;
  catalogue: VoiceEntry[];
  personas: string[];
  provider: VoiceProviderFacts;
  delivered: DeliveredVideoRow[];
}

/** The narration text of these scenes, in scene order — what the plans are built from. */
function narrationText(scenes: readonly SceneSource[]): string {
  return scenes
    .map((s) => (s.narration ?? "").trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}

/** The delivered file's own audio read-out, from the mux stage's ffprobe row. */
function deliveredAudioFor(row: DeliveredVideoRow): DeliveredAudioView {
  const m = row.measured;
  return {
    jobId: row.jobId,
    presetId: row.presetId,
    presetLabel: row.presetLabel,
    bytes: row.bytes,
    sha256: row.sha256,
    durationSeconds: m?.durationSeconds ?? null,
    videoCodec: m?.videoCodec ?? null,
    audioCodec: m?.audioCodec ?? null,
    audioChannels: m?.audioChannels ?? null,
    audioSampleRateHz: m?.audioSampleRateHz ?? null,
    measuredBy: m?.measuredBy ?? null,
    absentNarration: row.absences?.narration ?? null,
    absentMusic: row.absences?.music ?? null,
    absentSubtitles: row.absences?.subtitles ?? null,
  };
}

/**
 * The sentence about the delivered file's audio. Built from the rows passed in:
 * hand it none and it says none exists; hand it one and it names that file's
 * measured codec, channel count and sample rate — or says the row measured
 * nothing, rather than assuming.
 */
export function deliveredAudioSentence(files: readonly DeliveredAudioView[]): string {
  if (files.length === 0) {
    return (
      "No delivered video exists for this project, so there is no audio track to describe: no RenderArtefact row of " +
      'kind "delivered-container" belongs to any of this project\'s non-synthetic render jobs. Nothing is assumed ' +
      "about a file that does not exist."
    );
  }
  const parts = files.map((f) => {
    const measured =
      f.audioCodec !== null
        ? `${f.audioCodec}${f.audioChannels !== null ? ` ${f.audioChannels} channel${f.audioChannels === 1 ? "" : "s"}` : ""}` +
          `${f.audioSampleRateHz !== null ? ` at ${group(f.audioSampleRateHz)} Hz` : " at a sample rate the row does not record"}` +
          `${f.videoCodec !== null ? `, beside ${f.videoCodec} video` : ""}` +
          `${f.durationSeconds !== null ? `, ${f.durationSeconds.toFixed(3)} s` : ""}`
        : "no audio measurement: the job's container-mux stage recorded no ffprobe read-back, so this panel states none";
    return `Job ${f.jobId} (preset ${f.presetId}, ${f.presetLabel}): the audio track ffprobe read back from the delivered file is ${measured}.`;
  });
  const absences = files
    .map((f) => {
      const lines: string[] = [];
      if (f.absentNarration) lines.push(`narration — ${f.absentNarration}`);
      if (f.absentMusic) lines.push(`music and sound effects — ${f.absentMusic}`);
      if (f.absentSubtitles) lines.push(`subtitles — ${f.absentSubtitles}`);
      return lines.length > 0 ? `Job ${f.jobId} recorded that its file contains no ${lines.join("; no ")}.` : "";
    })
    .filter((s) => s.length > 0);
  return (
    `${parts.join(" ")} ${
      absences.length > 0
        ? absences.join(" ")
        : "The job recorded no statement of what its file does not contain, and this panel does not invent one."
    } This is what the file's own stage row measured — not a claim that the audio is narration, music or an effect.`
  );
}

export function deriveVoiceAudioView(input: VoiceAudioInput): VoiceAudioView {
  const catalogue: VoiceCatalogueRow[] = input.catalogue.map((v) => ({
    id: v.id,
    name: v.name,
    persona: v.persona,
    gender: v.gender,
    accent: v.accent,
    tone: v.tone,
    description: v.description,
    providerVoiceId: v.providerVoiceId,
    capabilities: v.capabilities,
  }));
  const nullCount = catalogue.filter((v) => v.providerVoiceId === null).length;

  const narration = narrationText(input.scenes);
  const scenesWithNarration = input.scenes.filter((s) => (s.narration ?? "").trim().length > 0).length;

  const sentence =
    `No text-to-speech provider is wired on this deployment, so no narration can be produced: the catalog below lists ` +
    `${catalogue.length} voice persona${catalogue.length === 1 ? "" : "s"} and ${nullCount} of them record ` +
    `providerVoiceId null, which is the column that would hold a provider-side voice id. The server names ` +
    `${envPhrase(input.provider.requiredEnv)} as the env var that would enable voice_generation` +
    `${input.provider.connected ? " (it is set on this deployment)" : " (none of them is set, and no serving slot is wired)"}.` +
    ` ${input.voiceoverRows === 0 ? "This project has no Voiceover row, so no narration file exists for it either." : `This project has ${input.voiceoverRows} Voiceover row${input.voiceoverRows === 1 ? "" : "s"}.`}`;

  /* ----- music select: the ranking the product would send ---------------- */
  const topic = [input.projectTitle, input.projectDescription ?? ""].join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
  const ranking = selectMusic({ topic });
  const category = findMusicCategory(ranking.top.categoryId);
  const music: MusicPlanView = {
    topic,
    top: ranking.top,
    ranked: ranking.ranked.slice(0, 6),
    category: category
      ? { name: category.name, moods: category.moods, typicalBpm: category.typicalBpm, useHint: category.useHint }
      : null,
  };

  /* ----- ducking: over the director's plan of this project's narration --- */
  let ducking: DuckingPlanView | null = null;
  let duckingMissingReason: string | null = null;
  if (narration.length === 0) {
    duckingMissingReason =
      "No scene in this project carries narration text, so there is no voice plan to duck music under and no " +
      "ducking schedule is shown. The schedule is derived from the narration, never assumed.";
  } else {
    const recommendation = getVoiceRecommendation({ scriptTone: narration.slice(0, 400) });
    const plan = directVoice(narration, { voiceId: recommendation.id });
    const schedule = buildDuckingSchedule({ voicePlan: plan });
    ducking = {
      timingModel: schedule.timingModel,
      events: schedule.ducking,
      mix: schedule.mix,
      voiceId: plan.voice,
      voiceName: recommendation.name,
      estimatedDurationMs: plan.estimatedDurationMs,
      scenesUsed: scenesWithNarration,
    };
  }

  /* ----- sfx: over the same scenes -------------------------------------- */
  const sfxScenes = input.scenes
    .filter((s) => (s.narration ?? "").trim().length > 0)
    .map((s) => ({
      sceneId: s.id,
      text: (s.narration ?? "").trim(),
      ...(s.durationSeconds !== null ? { durationMs: Math.round(s.durationSeconds * 1000) } : {}),
    }));
  let sfx: SfxPlanView | null = null;
  let sfxMissingReason: string | null = null;
  if (sfxScenes.length === 0) {
    sfxMissingReason =
      "No scene in this project carries narration text, so the sound-effects planner has nothing to place an effect " +
      "against and no schedule is shown.";
  } else {
    const planned = planSoundEffects({ scenes: sfxScenes });
    sfx = { timingModel: planned.timingModel, policy: planned.policy, events: planned.schedule };
  }

  const files = input.delivered.map(deliveredAudioFor);

  return {
    kind: "voice_audio",
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    catalogue: {
      voices: catalogue,
      count: catalogue.length,
      personas: input.personas,
      providerVoiceIdNullCount: nullCount,
      sentence,
    },
    provider: input.provider,
    voiceoverRows: input.voiceoverRows,
    plans: {
      sentence:
        "Everything in this section is a PLAN. It is the request the product would send and the timing it would use — " +
        "no audio file exists behind any line of it, because no music, sound-effects or text-to-speech provider is " +
        "wired on this deployment.",
      music,
      ducking,
      duckingMissingReason,
      sfx,
      sfxMissingReason,
      sceneCount: input.scenes.length,
      scenesWithNarration,
    },
    delivered: {
      exists: files.length > 0,
      files,
      sentence: deliveredAudioSentence(files),
    },
    note:
      "Read from this project's own Scene rows, the voice/music/sfx engines' deterministic output, the AI status " +
      "module's capability facts and the render job's own stage rows, on this request. Nothing here is cached and " +
      "nothing is typed at a call site.",
  };
}

/* ------------------------------------------------------------------ */
/* The Prisma wrapper                                                  */
/* ------------------------------------------------------------------ */

/** The capability facts the panel prints, derived from the provider registry. */
export function voiceProviderFacts(): VoiceProviderFacts {
  const status = capabilityStatus("voice_generation");
  return {
    capability: status.capability,
    connected: status.status === "connected",
    status: status.status,
    requiredEnv: [...status.requiredEnv],
    envNote: status.envNote,
    providers: status.providers.map((p) => ({ id: p.id, name: p.name, configured: p.configured, wired: p.wired })),
  };
}

export async function loadVoiceAudioView(input: {
  userId: string;
  projectId: string;
}): Promise<VoiceAudioView> {
  const source = await projectSceneSource(input.userId, input.projectId);
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true, title: true, description: true },
  });
  if (!project) {
    // projectSceneSource already 404s a foreign project; this is the same guard
    // for the row this loader needs itself.
    throw new ApiError(404, "Project not found.", "not_found");
  }

  const voiceoverRows = await prisma.voiceover.count({
    where: { asset: { projectId: input.projectId, userId: input.userId } },
  });
  const delivered = await loadDeliveredVideoRows({ userId: input.userId, projectId: input.projectId });

  return deriveVoiceAudioView({
    projectId: project.id,
    projectTitle: project.title,
    projectDescription: project.description ?? null,
    scenes: source.scenes,
    voiceoverRows,
    catalogue: listVoices(),
    personas: voicePersonas(),
    provider: voiceProviderFacts(),
    delivered,
  });
}
