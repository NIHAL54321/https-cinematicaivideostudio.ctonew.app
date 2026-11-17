/**
 * MUSIC INTO THE RENDER — the mix graph, the refusal, and the panel's sentence.
 * BLOCK M2, 2026-11-17.
 *
 * Three things live here, and each of them exists once so nothing can drift:
 *
 *  1. `musicFetchRefusal()` — the sentence the `music-fetch` stage THROWS when
 *     the selection's stored licence verdict is not a permission. It quotes the
 *     gate's own `reason` verbatim; it never paraphrases it.
 *  2. `musicInclusionSentence()` — what the Export panel prints BEFORE the
 *     Render button about music: whether a track will be mixed in, at what
 *     level, and the same stored verdict the stage reads. One function, so the
 *     panel's promise and the stage's behaviour are the same words.
 *  3. `buildMusicMixGraph()` — the ffmpeg filter graph, built from the project's
 *     own facts: the level (`ProjectSettings.musicDefaults.volume`, defaulting
 *     to `DEFAULT_MIX.musicVolume`), the fades (`DEFAULT_MIX.fadeInMs` /
 *     `fadeOutMs`), the fit to the video (loop / trim / exact, and which one it
 *     was), and the ducking schedule from `buildDuckingSchedule`.
 *
 * WHAT IT REFUSES TO DO
 *  - Invent narration timing. Duck points come from narration segments derived
 *    from the project's own scene rows; with none, NO ducking is applied and the
 *    record says `duckingApplied: false` with the reason.
 *  - Invent a level or a fade. Both come from the existing mix defaults.
 *  - Claim a measurement. Loudness is measured by ffmpeg's ebur128 and parsed by
 *    `parseEbur128Summary()` below; a figure it did not print is null.
 *
 * Pure and client-safe: no env, no file, no process, no Prisma.
 */
import { DEFAULT_MIX, buildDuckingSchedule, type DuckingEvent } from "@/lib/music/ducking";
import type { ProjectMusicFact } from "./types";

/** The loudness target every mix is measured against. */
export const LOUDNESS_TARGET_LUFS = -14;

/** One narration block on the master's timeline, in milliseconds. */
export interface NarrationSpan {
  startMs: number;
  endMs: number;
}

/**
 * Narration segments from the project's OWN scene rows: a scene that carries
 * narration text occupies its own span of the timeline (its declared duration,
 * placed after the scenes before it). This is the timing the project states —
 * there is no per-cue TTS timing in this app — and the mix record names it as
 * such rather than presenting it as speech detection.
 */
export function narrationSpansFromScenes(
  scenes: ReadonlyArray<{ durationSeconds: number | null; narrationChars: number }>,
): { spans: NarrationSpan[]; totalMs: number; basis: string } {
  let cursorMs = 0;
  const spans: NarrationSpan[] = [];
  for (const scene of scenes) {
    const ms = Math.max(0, Math.round((scene.durationSeconds ?? 0) * 1000));
    if (ms > 0 && scene.narrationChars > 0) spans.push({ startMs: cursorMs, endMs: cursorMs + ms });
    cursorMs += ms;
  }
  return {
    spans,
    totalMs: cursorMs,
    basis:
      "each scene that carries narration text occupies its own declared span of the timeline — the timing the project's " +
      "Scene rows state. There is no per-cue speech timing in this app, and none is invented.",
  };
}

/* ------------------------------------------------------------------ */
/* 1 — the refusal, in the stage's own words                           */
/* ------------------------------------------------------------------ */

export interface MusicRefusalInput {
  title: string;
  artist: string | null;
  /** The gate's own `reason`, quoted verbatim. */
  reason: string;
  basis: string;
}

/**
 * The sentence `music-fetch` throws when the stored verdict is not a permission.
 * The reason is quoted, not summarised: the user reads the licence gate's own
 * words, the same string the Music tab shows beside the refused track.
 */
export function musicFetchRefusal(input: MusicRefusalInput): string {
  const who = input.artist ? `${input.title} — ${input.artist}` : input.title;
  return (
    `music-fetch REFUSES to mix music into this project: the stored licence verdict for "${who}" is not a ` +
    `permission — "${input.reason}" (basis: ${input.basis}). The track is not downloaded and not encoded, so this ` +
    `delivery carries no music.`
  );
}

/* ------------------------------------------------------------------ */
/* 2 — what the panel says before the button                           */
/* ------------------------------------------------------------------ */

export interface MusicInclusionInput {
  music: Pick<ProjectMusicFact, "title" | "artist" | "verdict" | "volume"> | null;
}

/**
 * The Export panel's music line. It states one of three things — no selection,
 * a selection that will be mixed in, a selection the gate refuses — and in every
 * case it quotes the same stored verdict the `music-fetch` stage reads.
 */
export function musicInclusionSentence(input: MusicInclusionInput): string {
  const music = input.music;
  if (!music) {
    return (
      "No music is selected for this project, so the delivered file will carry no music: the music-fetch stage records " +
      "musicSelected: false and the encode runs the same argv it runs today."
    );
  }
  const who = music.artist ? `${music.title} — ${music.artist}` : music.title;
  const volume = typeof music.volume === "number" ? music.volume : DEFAULT_MIX.musicVolume;
  if (!music.verdict.permitted) {
    return (
      `Music: the selected track "${who}" will NOT be mixed in. The stored licence verdict refuses it: ` +
      `"${music.verdict.reason}" (basis: ${music.verdict.basis}). The music-fetch stage refuses with that sentence ` +
      `before any encode runs, so the delivery carries no music.`
    );
  }
  return (
    `Music: "${who}" is selected and will be mixed in at volume ${volume} with a ${DEFAULT_MIX.fadeInMs} ms fade in ` +
    `and a ${DEFAULT_MIX.fadeOutMs} ms fade out, fitted to the video's length, ducked by ${DEFAULT_MIX.duckedDepthDb} dB ` +
    `where the project's own scene rows give narration timing, and measured with ebur128 against a ` +
    `${LOUDNESS_TARGET_LUFS} LUFS target. The stored licence verdict reads: "${music.verdict.reason}" ` +
    `(basis: ${music.verdict.basis} — the licence claim is the uploader's and has not been verified).`
  );
}

/* ------------------------------------------------------------------ */
/* 3 — the mix graph                                                   */
/* ------------------------------------------------------------------ */

export type MusicFit = "looped" | "trimmed" | "exact" | "not-applied";

export interface MusicMixInput {
  music: ProjectMusicFact | null;
  /** The fetched bed's own measured length, from ffprobe. */
  bedSeconds: number | null;
  /** The master's length, from the timeline's own scene durations. */
  targetSeconds: number;
  narration: NarrationSpan[];
  /** The delivery's audio layout, from the job's resolved preset. */
  sampleRateHz: number;
  channels: number;
}

export interface MusicMixPlan {
  applied: boolean;
  /** Why no music was mixed, when `applied` is false. */
  why: string | null;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  fit: MusicFit;
  /** Which fit happened, in words, from the two lengths. */
  fitSentence: string;
  targetSeconds: number;
  bedSeconds: number | null;
  ducking: DuckingEvent[];
  duckingApplied: boolean;
  duckingSentence: string;
  /** Extra input arguments the graph needs (a looping bed). */
  inputArgs: string[];
  /** The ffmpeg filter graph, or null when nothing is mixed. */
  filterComplex: string | null;
  /** The output maps the graph requires. */
  maps: string[];
}

const round3 = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * Build the filter graph that puts the fetched bed under the program audio.
 *
 * The chain is, in order: resample to the delivery layout → trim (or loop) to
 * the master's length → the project's volume → fade in → fade out → the ducking
 * events as timed volume filters → an `amix` with the program audio, whose
 * duration is the program's (so the picture and the sound end together).
 */
export function buildMusicMixGraph(input: MusicMixInput): MusicMixPlan {
  const target = Math.max(0, input.targetSeconds);
  const base: MusicMixPlan = {
    applied: false,
    why: null,
    volume: DEFAULT_MIX.musicVolume,
    fadeInMs: DEFAULT_MIX.fadeInMs,
    fadeOutMs: DEFAULT_MIX.fadeOutMs,
    fit: "not-applied",
    fitSentence: "no music bed is on this delivery",
    targetSeconds: target,
    bedSeconds: input.bedSeconds,
    ducking: [],
    duckingApplied: false,
    duckingSentence: "no music, so nothing is ducked",
    inputArgs: [],
    filterComplex: null,
    maps: [],
  };
  const music = input.music;
  if (!music) {
    return {
      ...base,
      why: "the project has no music selection, so nothing is mixed and the encode argv is unchanged",
    };
  }
  if (!music.verdict.permitted) {
    return {
      ...base,
      why:
        "the stored licence verdict is not a permission, so no bed is mixed in — the music-fetch stage refuses before " +
        "this graph is ever built",
    };
  }
  if (input.bedSeconds === null) {
    return {
      ...base,
      why: "the fetched bed's length was not measured, so no fit can be claimed and nothing is mixed",
    };
  }

  const volume =
    typeof music.volume === "number" && Number.isFinite(music.volume)
      ? Math.min(1, Math.max(0, music.volume))
      : DEFAULT_MIX.musicVolume;
  const fadeInMs = DEFAULT_MIX.fadeInMs;
  const fadeOutMs = DEFAULT_MIX.fadeOutMs;

  // FIT — a bed shorter than the video loops; a longer one is trimmed, and the
  // record says which of the two happened rather than "fitted".
  const tolerance = 0.05;
  const fit: MusicFit =
    input.bedSeconds < target - tolerance ? "looped" : input.bedSeconds > target + tolerance ? "trimmed" : "exact";
  const fitSentence =
    fit === "looped"
      ? `the bed measures ${round3(input.bedSeconds)} s and the master ${round3(target)} s, so the bed is LOOPED to cover the video`
      : fit === "trimmed"
        ? `the bed measures ${round3(input.bedSeconds)} s and the master ${round3(target)} s, so the bed is TRIMMED to the master and faded out over its last ${fadeOutMs} ms`
        : `the bed measures ${round3(input.bedSeconds)} s and the master ${round3(target)} s, so the bed is used at its own length`;

  // DUCKING — from the project's own narration spans, or not at all.
  const schedule = buildDuckingSchedule({
    voicePlan: { segments: input.narration, totalMs: Math.round(target * 1000) },
    musicSegments: [{ startMs: 0, endMs: Math.round(target * 1000) }],
    musicVolume: volume,
    fadeInMs,
    fadeOutMs,
  });
  const duckEvents = input.narration.length === 0 ? [] : schedule.ducking.filter((e) => e.dB !== 0);
  const duckingApplied = duckEvents.length > 0;
  const duckingSentence =
    input.narration.length === 0
      ? "the project has no narration timing — no scene carries narration text — so NO ducking is applied and no duck point is invented"
      : duckingApplied
        ? `${duckEvents.length} ducking region(s) at ${schedule.mix.duckedDepthDb} dB down, from ${input.narration.length} narration span(s) taken from the project's own scene rows (${schedule.timingModel})`
        : "narration timing exists but produced no ducking region, so none is applied";

  const layout = input.channels === 1 ? "mono" : "stereo";
  const chain: string[] = [
    `aresample=${input.sampleRateHz}`,
    `aformat=sample_fmts=fltp:channel_layouts=${layout}`,
    `atrim=0:${round3(target)}`,
    "asetpts=PTS-STARTPTS",
    `volume=${round3(volume)}`,
  ];
  if (fadeInMs > 0) chain.push(`afade=t=in:st=0:d=${round3(fadeInMs / 1000)}`);
  const fadeOutStart = target - fadeOutMs / 1000;
  if (fadeOutMs > 0 && fadeOutStart > 0) chain.push(`afade=t=out:st=${round3(fadeOutStart)}:d=${round3(fadeOutMs / 1000)}`);
  for (const event of duckEvents) {
    chain.push(
      `volume=volume=${event.dB}dB:enable='between(t,${round3(event.startMs / 1000)},${round3(event.endMs / 1000)})'`,
    );
  }

  const filterComplex =
    `[1:a]${chain.join(",")}[musicbed];` +
    `[0:a][musicbed]amix=inputs=2:duration=first:normalize=0[aout]`;

  return {
    applied: true,
    why: null,
    volume,
    fadeInMs,
    fadeOutMs,
    fit,
    fitSentence,
    targetSeconds: target,
    bedSeconds: input.bedSeconds,
    ducking: duckEvents,
    duckingApplied,
    duckingSentence,
    // A looping bed is looped at the INPUT, so the graph sees a stream longer
    // than the master and trims it — the same atrim handles both cases.
    inputArgs: fit === "looped" ? ["-stream_loop", "-1"] : [],
    filterComplex,
    maps: ["-map", "0:v:0", "-map", "[aout]"],
  };
}

/* ------------------------------------------------------------------ */
/* ebur128, parsed from what ffmpeg actually printed                    */
/* ------------------------------------------------------------------ */

export interface LoudnessMeasurement {
  integratedLufs: number | null;
  truePeakDbfs: number | null;
}

/**
 * Integrated loudness and true peak from an `ebur128` run's output. A figure
 * ffmpeg did not print is null — never estimated from the bitrate, the tone or
 * the sample count.
 */
export function parseEbur128Summary(text: string): LoudnessMeasurement {
  const out = typeof text === "string" ? text : "";
  const tail = out.lastIndexOf("Summary:") === -1 ? out : out.slice(out.lastIndexOf("Summary:"));
  const integrated = /Integrated loudness:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(tail);
  const peak = /True peak:[\s\S]*?\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/.exec(tail);
  return {
    integratedLufs: integrated ? Number(integrated[1]) : null,
    truePeakDbfs: peak ? Number(peak[1]) : null,
  };
}
