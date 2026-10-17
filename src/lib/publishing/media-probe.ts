/**
 * Phase 7 Block 5 — MEASURING A PRODUCED FILE (server only).
 *
 * This is the only place in the publishing feature that runs an external tool or
 * reads the filesystem. It produces plain FACTS (`ProbedFileFacts` /
 * `LoudnessFacts`, both declared in ./quality) and hands them to the pure quality
 * checker, which decides pass / fail / not measured. Keeping the split here means
 * the checker is testable without a file, and a test can hand it a file that
 * fails.
 *
 * WHAT IT DOES WHEN THERE IS NO FILE — which is the state of this server today,
 * because no export has ever completed: it returns `{ state: "absent" }` and names
 * both things that would have to exist (a produced file, and a probe tool). It
 * never returns neutral-looking zeros, and nothing downstream can turn an absent
 * file into a pass.
 *
 * THE TOOL. `ffprobe` with `-print_format json -show_format -show_streams`, which
 * is its documented machine-readable form, and an ffmpeg `ebur128` pass for
 * loudness and true peak. Both are injected (`ToolRunner`) so the parsers are
 * tested against real tool output shapes without a tool or a file being present.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { PublishingSource } from "./types";
import type { FileProbeOutcome, LoudnessOutcome, ProbedAudioStream, ProbedFileFacts } from "./quality";

/** Runs a tool and returns its stdout. Injected so tests need no binary. */
export type ToolRunner = (command: string, args: readonly string[]) => string;

const DEFAULT_TIMEOUT_MS = 20_000;

/** The default runner: the real binary, with a timeout so a hung probe cannot hang a request. */
export const execToolRunner: ToolRunner = (command, args) =>
  execFileSync(command, [...args], { encoding: "utf8", timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });

export interface ProbeDeps {
  run?: ToolRunner;
  /** Injected in tests. */
  fileExists?: (path: string) => boolean;
  fileSize?: (path: string) => number | null;
  /** A tool that is not installed is reported as such, never as a zero measurement. */
  toolVersion?: (command: string) => string | null;
}

function defaultToolVersion(command: string): string | null {
  try {
    const out = execFileSync(command, ["-version"], { encoding: "utf8", timeout: 5_000 });
    const first = out.split("\n")[0]?.trim() ?? "";
    return first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** "30000/1001" → 29.97002997; "30" → 30. A non-numeric rate is null. */
export function parseRate(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const raw = String(v).trim();
  if (raw === "" || raw === "0/0") return null;
  if (raw.includes("/")) {
    const [num, den] = raw.split("/");
    const n = Number(num);
    const d = Number(den);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  }
  const single = Number(raw);
  return Number.isFinite(single) && single > 0 ? single : null;
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string; size?: string; format_name?: string };
}

/** The parsed measurement, without the path/size the caller already knows. */
export interface ParsedProbe {
  widthPx: number | null;
  heightPx: number | null;
  frameRateAvg: number | null;
  frameRateDeclared: number | null;
  durationSeconds: number | null;
  videoBitrateKbps: number | null;
  overallBitrateKbps: number | null;
  videoCodec: string | null;
  audioStreams: ProbedAudioStream[];
}

/**
 * Parses ffprobe's JSON. Strict about what counts as a fact: a field the tool did
 * not report is null. A missing video stream means the pixel dimensions are null,
 * not 0×0.
 */
export function parseFfprobeJson(json: string): ParsedProbe {
  const parsed = JSON.parse(json) as FfprobeJson;
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === "video") ?? null;
  const audioStreams: ProbedAudioStream[] = streams
    .filter((s) => s.codec_type === "audio")
    .map((s) => ({
      index: typeof s.index === "number" ? s.index : -1,
      codec: typeof s.codec_name === "string" ? s.codec_name : null,
      channels: numberOrNull(s.channels),
      sampleRateHz: numberOrNull(s.sample_rate),
    }));
  const videoBitrate = video ? numberOrNull(video.bit_rate) : null;
  const duration = numberOrNull(parsed.format?.duration) ?? (video ? numberOrNull(video.duration) : null);
  return {
    widthPx: video ? numberOrNull(video.width) : null,
    heightPx: video ? numberOrNull(video.height) : null,
    frameRateAvg: video ? parseRate(video.avg_frame_rate) : null,
    frameRateDeclared: video ? parseRate(video.r_frame_rate) : null,
    durationSeconds: duration,
    videoBitrateKbps: videoBitrate === null ? null : Math.round(videoBitrate / 1000),
    overallBitrateKbps: (() => {
      const overall = numberOrNull(parsed.format?.bit_rate);
      return overall === null ? null : Math.round(overall / 1000);
    })(),
    videoCodec: video && typeof video.codec_name === "string" ? video.codec_name : null,
    audioStreams,
  };
}

/** The ffprobe argument list. Exported so a test can assert what is actually asked for. */
export const FFPROBE_ARGS = (path: string): string[] => [
  "-v",
  "error",
  "-print_format",
  "json",
  "-show_format",
  "-show_streams",
  path,
];

/** The ffmpeg argument list for an ebur128 loudness pass. */
export const LOUDNESS_ARGS = (path: string): string[] => [
  "-hide_banner",
  "-nostats",
  "-i",
  path,
  "-af",
  "ebur128=peak=true",
  "-f",
  "null",
  "-",
];

/**
 * Parses ffmpeg's ebur128 SUMMARY block. Only the two figures this product
 * reports are read: integrated loudness (the `I:` line inside the Integrated
 * loudness block) and true peak (the `Peak:` line inside the True peak block).
 * Anything else — including the absence of those lines — yields null, and a
 * measurement without both figures is not a measurement.
 */
export function parseEbur128(output: string): { integratedLufs: number | null; truePeakDbfs: number | null } {
  const summaryStart = output.lastIndexOf("Summary:");
  const tail = summaryStart === -1 ? output : output.slice(summaryStart);
  const integratedMatch = /Integrated loudness:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(tail);
  const peakMatch = /True peak:[\s\S]*?\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/.exec(tail);
  return {
    integratedLufs: integratedMatch ? Number(integratedMatch[1]) : null,
    truePeakDbfs: peakMatch ? Number(peakMatch[1]) : null,
  };
}

const NO_FILE_REQUIRES = [
  "a produced video file: an export job that reached COMPLETED and whose output exists at a path on this machine",
];

const NO_TOOL_REQUIRES = [
  "a produced video file to read, and an ffprobe binary on this machine to read it with",
];

/**
 * Measures the produced file, when there is one. The three outcomes are the three
 * honest states of this question and none of them is a pass:
 *
 *   - `probed` — a file existed, the tool ran, and its numbers are below;
 *   - `absent` — there is no produced file (the state of this server);
 *   - `failed` — something existed but the measurement could not be taken (no
 *     tool, a tool error, unparseable output). Also never a pass.
 */
export function probeProducedFile(path: string | null, deps: ProbeDeps = {}, reason?: string): FileProbeOutcome {
  const exists = deps.fileExists ?? ((p: string) => existsSync(p));
  const sizeOf = deps.fileSize ?? ((p: string) => {
    try {
      return statSync(p).size;
    } catch {
      return null;
    }
  });
  if (!path) {
    return {
      state: "absent",
      reason: reason ?? "No produced video file exists for this project: no export job has ever completed, so there is nothing for a probe to read.",
      requires: NO_FILE_REQUIRES,
    };
  }
  if (!exists(path)) {
    return {
      state: "absent",
      reason:
        `An export job records an output, but no file exists at ${path} on this machine, so there is nothing for a probe to read` +
        `${reason ? ` (${reason})` : ""}.`,
      requires: NO_FILE_REQUIRES,
    };
  }
  const version = (deps.toolVersion ?? defaultToolVersion)("ffprobe");
  if (version === null) {
    const size = sizeOf(path);
    return {
      state: "failed",
      reason:
        `A file exists at ${path}${size === null ? "" : ` (${size} byte(s))`}, but no ffprobe binary is installed on this machine, so its streams were not read. ` +
        `A file that has not been measured is not a measured file.`,
      requires: NO_TOOL_REQUIRES,
    };
  }
  try {
    const out = (deps.run ?? execToolRunner)("ffprobe", FFPROBE_ARGS(path));
    const parsed = parseFfprobeJson(out);
    const size = sizeOf(path);
    if (size === null) {
      return {
        state: "failed",
        reason: `ffprobe read ${path} but the file's size could not be read from the filesystem.`,
        requires: ["a readable file size"],
      };
    }
    const facts: ProbedFileFacts = { path, sizeBytes: size, ...parsed, tool: version };
    return { state: "probed", facts };
  } catch (err) {
    return {
      state: "failed",
      reason: `ffprobe could not read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      requires: ["a file ffprobe can read, and a probe that succeeds"],
    };
  }
}

/** Measures loudness and true peak with ffmpeg's ebur128 filter. */
export function measureLoudness(path: string | null, deps: ProbeDeps = {}): LoudnessOutcome {
  const exists = deps.fileExists ?? ((p: string) => existsSync(p));
  if (!path || !exists(path)) {
    return {
      state: "absent",
      reason:
        "No produced video file exists for this project, so there is no audio to measure loudness on. " +
        "A loudness figure is not estimated from the scene durations or from the mix settings.",
      requires: ["a produced video file with an audio stream, and an ffmpeg binary to run the loudness pass"],
    };
  }
  const version = (deps.toolVersion ?? defaultToolVersion)("ffmpeg");
  if (version === null) {
    return {
      state: "failed",
      reason: `A file exists at ${path}, but no ffmpeg binary is installed on this machine, so the loudness pass could not run.`,
      requires: ["an ffmpeg binary on this machine, and a produced file with an audio stream"],
    };
  }
  try {
    const out = (deps.run ?? execToolRunner)("ffmpeg", LOUDNESS_ARGS(path));
    const parsed = parseEbur128(out);
    if (parsed.integratedLufs === null || parsed.truePeakDbfs === null) {
      return {
        state: "failed",
        reason: `The ffmpeg loudness pass ran on ${path} but its summary reported no ${parsed.integratedLufs === null ? "integrated loudness" : "true peak"}, so no measurement is claimed.`,
        requires: ["an ebur128 summary carrying both the integrated loudness and the true peak"],
      };
    }
    return {
      state: "measured",
      facts: { integratedLufs: parsed.integratedLufs, truePeakDbfs: parsed.truePeakDbfs, tool: version },
    };
  } catch (err) {
    return {
      state: "failed",
      reason: `The ffmpeg loudness pass on ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
      requires: ["an ffmpeg loudness pass that succeeds"],
    };
  }
}

/** The output path a completed export job recorded, or null. Only local paths count. */
export function producedFilePath(source: PublishingSource): { path: string | null; reason: string } {
  const jobs = source.exportJobs ?? [];
  const completed = jobs.filter((j) => j.status === "COMPLETED");
  if (completed.length === 0) {
    const any = jobs.length;
    return {
      path: null,
      reason:
        any === 0
          ? "This project has no export job at all, so no render was ever started and no file was ever produced."
          : `This project has ${any} export job(s) and none of them reached COMPLETED, so no render finished and no file was ever produced.`,
    };
  }
  const job = completed[completed.length - 1]!;
  const candidate = job.outputUrl ?? job.s3Key ?? null;
  if (!candidate) {
    return { path: null, reason: `Export job ${job.id} is COMPLETED but records no output path, so there is no file to read.` };
  }
  if (!candidate.startsWith("/")) {
    return {
      path: null,
      reason:
        `Export job ${job.id} is COMPLETED and records its output as "${candidate}", which is not a path on this machine, so the file was not read. ` +
        `An object key or a URL is not a file, and this app does not fetch one to measure it.`,
    };
  }
  return { path: candidate, reason: "" };
}

/** Everything the quality checker needs from the file side of this project. */
export function measureProducedFile(
  source: PublishingSource,
  deps: ProbeDeps = {},
): { file: FileProbeOutcome; loudness: LoudnessOutcome } {
  const { path, reason } = producedFilePath(source);
  const file = probeProducedFile(path, deps, reason || undefined);
  const loudness = measureLoudness(path, deps);
  return { file, loudness };
}
