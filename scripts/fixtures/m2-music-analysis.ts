/**
 * BLOCK M2 — the evidence arithmetic, from the three case files.
 *
 * Reads case-{synthetic,catalogue,none}.json (written by
 * m2-music-deliveries.ts) and writes:
 *
 *   loudness-before-after.json   the bed's own ebur128 figure beside the
 *                                delivered file's, per case
 *   short-window-levels.json     the one-second RMS traces of all three files,
 *                                the music-minus-control difference, the
 *                                ducking spans the job recorded, and the
 *                                averages inside and outside them
 *
 * Every number here is read from a measurement in the case files. Nothing is
 * estimated and nothing is filled in when a figure is missing — a missing
 * measurement stays null.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.M2_OUT ?? "/home/team/render-out/phase8_music_mixing";
const CASES = ["synthetic", "catalogue", "none"] as const;

type Trace = Array<{ t: number; rms: number }>;
interface CaseFile {
  kase: string;
  jobId: string;
  panelSentence: string;
  musicFactReadByThePipeline: { title: string; verdict: { permitted: boolean; reason: string; basis: string } } | null;
  delivery: { writtenBytes: number; writtenSha256: string; servedFrom: string; recordedBytes: number };
  ffprobe: { streams: Array<Record<string, unknown>>; format: Record<string, unknown> };
  loudnessMeasuredOnTheDeliveredFile: { integratedLufs: number | null; truePeakDbfs: number | null };
  bed: { path: string; bytes: number | null; sha256: string | null; loudnessMeasured: { integratedLufs: number | null; truePeakDbfs: number | null } | null } | null;
  encodeMasterMusicMix: Record<string, unknown> | null;
  oneSecondRmsTraceOfTheDeliveredFile: Trace;
}

const read = (kase: string): CaseFile => JSON.parse(readFileSync(join(OUT, `case-${kase}.json`), "utf8")) as CaseFile;

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

function main() {
  const files = CASES.filter((k) => existsSync(join(OUT, `case-${k}.json`))).map(read);
  const control = files.find((f) => f.kase === "none");
  const byT = new Map<number, number>();
  for (const p of control?.oneSecondRmsTraceOfTheDeliveredFile ?? []) byT.set(p.t, p.rms);

  const loudness = files.map((f) => ({
    kase: f.kase,
    jobId: f.jobId,
    bedMeasured: f.bed?.loudnessMeasured
      ? { integratedLufs: f.bed.loudnessMeasured.integratedLufs, truePeakDbfs: f.bed.loudnessMeasured.truePeakDbfs, bytes: f.bed.bytes, sha256: f.bed.sha256 }
      : null,
    deliveredMeasured: {
      integratedLufs: f.loudnessMeasuredOnTheDeliveredFile.integratedLufs,
      truePeakDbfs: f.loudnessMeasuredOnTheDeliveredFile.truePeakDbfs,
    },
    /** What the JOB's own row says it measured — quoted, not recomputed. */
    jobRecordedLoudness: (f.encodeMasterMusicMix?.measuredLoudness as Record<string, unknown> | undefined) ?? null,
    targetLufs: (f.encodeMasterMusicMix?.measuredLoudness as { targetLufs?: number } | undefined)?.targetLufs ?? -14,
    audioStream: (f.ffprobe.streams.find((s) => s.codec_type === "audio") as Record<string, unknown> | undefined) ?? null,
    audioStreamCount: f.ffprobe.streams.filter((s) => s.codec_type === "audio").length,
    durationSeconds: Number(f.ffprobe.format.duration ?? NaN),
    bytes: f.delivery.writtenBytes,
    sha256: f.delivery.writtenSha256,
    servedFrom: f.delivery.servedFrom,
  }));

  const levels = files.map((f) => {
    const ducking = ((f.encodeMasterMusicMix?.ducking as Array<{ startMs: number; endMs: number; dB: number }> | undefined) ?? []).map(
      (d) => ({ startSeconds: d.startMs / 1000, endSeconds: d.endMs / 1000, dB: d.dB }),
    );
    const delta = f.oneSecondRmsTraceOfTheDeliveredFile.map((p) => {
      const base = byT.get(p.t);
      return { t: p.t, musicMinusControlDb: base === undefined ? null : Math.round((p.rms - base) * 10) / 10 };
    });
    const inDuck = delta.filter((d) => d.musicMinusControlDb !== null && ducking.some((k) => d.t >= k.startSeconds && d.t < k.endSeconds)).map((d) => d.musicMinusControlDb as number);
    const outDuck = delta.filter((d) => d.musicMinusControlDb !== null && !ducking.some((k) => d.t >= k.startSeconds && d.t < k.endSeconds)).map((d) => d.musicMinusControlDb as number);
    return {
      kase: f.kase,
      duckingSpansRecordedByTheJob: ducking,
      duckingApplied: Boolean(f.encodeMasterMusicMix?.duckingApplied),
      fit: f.encodeMasterMusicMix?.fit ?? null,
      fitSentence: f.encodeMasterMusicMix?.fitSentence ?? null,
      volume: f.encodeMasterMusicMix?.volume ?? null,
      fadeInMs: f.encodeMasterMusicMix?.fadeInMs ?? null,
      fadeOutMs: f.encodeMasterMusicMix?.fadeOutMs ?? null,
      filterComplex: f.encodeMasterMusicMix?.filterComplex ?? null,
      rmsTraceOfTheDeliveredFile: f.oneSecondRmsTraceOfTheDeliveredFile,
      musicMinusControl: delta,
      summary: {
        meanMusicMinusControlInsideDuckedSpansDb: mean(inDuck),
        meanMusicMinusControlOutsideDuckedSpansDb: mean(outDuck),
        differenceDb:
          mean(inDuck) !== null && mean(outDuck) !== null ? Math.round(((mean(outDuck) as number) - (mean(inDuck) as number)) * 10) / 10 : null,
        firstSecondMusicMinusControlDb: delta[0]?.musicMinusControlDb ?? null,
        lastSecondMusicMinusControlDb: delta[delta.length - 1]?.musicMinusControlDb ?? null,
      },
    };
  });

  writeFileSync(join(OUT, "loudness-before-after.json"), JSON.stringify(loudness, null, 2));
  writeFileSync(join(OUT, "short-window-levels.json"), JSON.stringify(levels, null, 2));

  for (const l of loudness) {
    console.log(`${l.kase.padEnd(10)} bed ${String(l.bedMeasured?.integratedLufs ?? "—").padStart(7)} LUFS → delivered ${String(l.deliveredMeasured.integratedLufs ?? "—").padStart(7)} LUFS, peak ${String(l.deliveredMeasured.truePeakDbfs ?? "—")} dBFS, ${l.audioStreamCount} audio stream(s), ${l.durationSeconds.toFixed(3)} s, ${l.bytes} B`);
  }
  for (const l of levels) {
    console.log(
      `${l.kase.padEnd(10)} fit=${String(l.fit)} duckedSpans=${l.duckingSpansRecordedByTheJob.length} in=${String(l.summary.meanMusicMinusControlInsideDuckedSpansDb)} dB out=${String(l.summary.meanMusicMinusControlOutsideDuckedSpansDb)} dB step=${String(l.summary.differenceDb)} dB first=${String(l.summary.firstSecondMusicMinusControlDb)} last=${String(l.summary.lastSecondMusicMinusControlDb)}`,
    );
  }
}

main();
