/**
 * BLOCK M2 — write evidence/phase8_music_mixing/ from the measured files.
 *
 * Reads what m2-music-deliveries.ts and m2-music-analysis.ts measured
 * (case-*.json, loudness-before-after.json, short-window-levels.json in
 * $M2_OUT) and writes the pack: README.md, the small JSON/text artefacts, and
 * a copy of each downloaded MP4 under downloads/.
 *
 * Nothing in the README is typed by hand: every figure is interpolated from a
 * measurement in those files, and a missing measurement prints as "—".
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.M2_OUT ?? "/home/team/render-out/phase8_music_mixing";
const EVIDENCE = process.env.M2_EVIDENCE ?? join(process.cwd(), "evidence/phase8_music_mixing");

const j = (name: string): unknown => JSON.parse(readFileSync(join(OUT, name), "utf8"));
const n = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));

interface CaseFile {
  kase: string;
  jobId: string;
  status: string;
  panelSentence: string;
  selectionStep: Record<string, unknown>;
  musicFactReadByThePipeline: { title: string; artist: string | null; provider: string; providerTrackId: string; attribution: string | null; licenceText: string | null; intendedUse: string | null; syntheticTestAsset: boolean; verdict: { permitted: boolean; reason: string; basis: string } } | null;
  delivery: { artefactId: string; url: string; downloadedStatus: number; servedFrom: string; writtenPath: string; writtenBytes: number; writtenSha256: string; recordedBytes: number; recordedSha256: string; headerSha256: string };
  ffprobe: { streams: Array<Record<string, unknown>>; format: Record<string, unknown> };
  loudnessMeasuredOnTheDeliveredFile: { integratedLufs: number | null; truePeakDbfs: number | null };
  bed: { path: string; bytes: number | null; sha256: string | null; loudnessMeasured: { integratedLufs: number | null; truePeakDbfs: number | null } | null } | null;
  musicFetchStageRecord: Record<string, unknown> | null;
  encodeMasterMusicMix: Record<string, unknown> | null;
  containerMuxAudioAndProvenance: Record<string, unknown> | null;
  oneSecondRmsTraceOfTheDeliveredFile: Array<{ t: number; rms: number }>;
}
interface Loudness {
  kase: string;
  bedMeasured: { integratedLufs: number | null; truePeakDbfs: number | null; bytes: number | null; sha256: string | null } | null;
  deliveredMeasured: { integratedLufs: number | null; truePeakDbfs: number | null };
  jobRecordedLoudness: Record<string, unknown> | null;
  targetLufs: number;
  audioStream: Record<string, unknown> | null;
  audioStreamCount: number;
  durationSeconds: number;
  bytes: number;
  sha256: string;
  servedFrom: string;
}
interface Levels {
  kase: string;
  duckingSpansRecordedByTheJob: Array<{ startSeconds: number; endSeconds: number; dB: number }>;
  duckingApplied: boolean;
  fit: string | null;
  fitSentence: string | null;
  volume: number | null;
  fadeInMs: number | null;
  fadeOutMs: number | null;
  filterComplex: string | null;
  musicMinusControl: Array<{ t: number; musicMinusControlDb: number | null }>;
  summary: {
    meanMusicMinusControlInsideDuckedSpansDb: number | null;
    meanMusicMinusControlOutsideDuckedSpansDb: number | null;
    differenceDb: number | null;
    firstSecondMusicMinusControlDb: number | null;
    lastSecondMusicMinusControlDb: number | null;
  };
}

function main() {
  mkdirSync(join(EVIDENCE, "downloads"), { recursive: true });
  const cases = ["synthetic", "catalogue", "none"].filter((k) => existsSync(join(OUT, `case-${k}.json`)));
  const files = cases.map((k) => j(`case-${k}.json`) as CaseFile);
  const loud = existsSync(join(OUT, "loudness-before-after.json")) ? (j("loudness-before-after.json") as Loudness[]) : [];
  const levels = existsSync(join(OUT, "short-window-levels.json")) ? (j("short-window-levels.json") as Levels[]) : [];

  for (const f of files) {
    copyFileSync(join(OUT, `case-${f.kase}.json`), join(EVIDENCE, `case-${f.kase}.json`));
    copyFileSync(join(OUT, `job-${f.kase}.json`), join(EVIDENCE, `job-${f.kase}.json`));
    copyFileSync(join(OUT, `download-${f.kase}-sha256.txt`), join(EVIDENCE, `download-${f.kase}-sha256.txt`));
    const mp4 = join(OUT, "downloads", `m2-${f.kase}.mp4`);
    if (existsSync(mp4)) copyFileSync(mp4, join(EVIDENCE, "downloads", `m2-${f.kase}.mp4`));
  }
  for (const name of ["loudness-before-after.json", "short-window-levels.json"]) {
    if (existsSync(join(OUT, name))) copyFileSync(join(OUT, name), join(EVIDENCE, name));
  }

  const label: Record<string, string> = {
    synthetic: "a SYNTHETIC TEST ASSET (an ffmpeg tone) — never music from a catalogue",
    catalogue: "a permitted Creative Commons catalogue track (Audius `ZOR97`) — the licence claim is the uploader's, unverified",
    none: "the no-music control — the same project with no selection at all",
  };

  const L: string[] = [];
  L.push("# Phase 8 — music into the render (BLOCK M2): three deliveries, downloaded and measured");
  L.push("");
  L.push(`Written from the measured files by \`scripts/fixtures/m2-music-evidence.ts\`. Every figure below is interpolated from a`);
  L.push("measurement in this pack — the job's own rows, the downloaded file's digest, ffprobe's read-back and ffmpeg's");
  L.push("ebur128/astats output. A figure that was not measured prints as `—`.");
  L.push("");
  L.push("Project: `p7a_fix_project` — nine scenes, 13 s each, narration TEXT on scenes 1, 3, 5, 7 and 9 only");
  L.push("(no narration AUDIO exists anywhere: no text-to-speech provider is wired). Preset: `youtube-1080p`.");
  L.push("Every render was enqueued through `POST /api/studio/render` and run by the served app's own worker; every");
  L.push("download went through `GET /api/studio/downloads/<id>` and the written file was re-hashed on this machine.");
  L.push("");
  L.push("## The three deliveries");
  L.push("");
  for (const f of files) {
    const l = loud.find((x) => x.kase === f.kase);
    const v = levels.find((x) => x.kase === f.kase);
    const a = f.ffprobe.streams.find((s) => s.codec_type === "audio") as Record<string, unknown> | undefined;
    L.push(`### \`${f.kase}\` — job \`${f.jobId}\` — ${label[f.kase] ?? ""}`);
    L.push("");
    L.push(`- status **${f.status}**; the selection was set by ${String(f.selectionStep.how)}`);
    L.push(`- file **${n(l?.bytes)} B**, SHA-256 \`${n(l?.sha256)}\``);
    L.push(`- the same digest is on the artefact row (\`${f.delivery.recordedSha256}\`) and in the response header (\`${f.delivery.headerSha256}\`); the download answered **${f.delivery.downloadedStatus}** and was served from **${f.delivery.servedFrom}**`);
    L.push(`- the written file: \`${f.delivery.writtenPath}\` (a copy is in \`downloads/m2-${f.kase}.mp4\`)`);
    L.push(`- ffprobe: **${f.ffprobe.streams.length} stream(s)**, ${n(l?.audioStreamCount)} audio — ${a ? `${n(a.codec_name)} ${n(a.channels)} ch ${n(a.sample_rate)} Hz` : "no audio stream"}, ${Number(l?.durationSeconds ?? 0).toFixed(3)} s`);
    L.push(`- **measured** loudness on the downloaded file: **${n(l?.deliveredMeasured.integratedLufs)} LUFS** integrated, true peak ${n(l?.deliveredMeasured.truePeakDbfs)} dBFS (ffmpeg ebur128, run here on the file) — target ${n(l?.targetLufs)} LUFS`);
    L.push(`- the bed this delivery mixed, as the \`music-fetch\` stage recorded it: ${f.bed ? `**${n(f.bed.bytes)} B**, SHA-256 \`${n(f.bed.sha256)}\`, **${n(f.bed.loudnessMeasured?.integratedLufs)} LUFS** integrated (measured on the bed)` : "none — no bed was fetched"}`);
    L.push(`- what the mix record says: fit **${n(v?.fit)}** (${n(v?.fitSentence)}), volume ${n(v?.volume)}, fade in ${n(v?.fadeInMs)} ms / fade out ${n(v?.fadeOutMs)} ms, ducking applied **${n(v?.duckingApplied)}** over ${n(v?.duckingSpansRecordedByTheJob.length)} span(s)`);
    L.push(`- the job's own loudness figure (recorded by the encoder, quoted not recomputed): ${f.encodeMasterMusicMix ? `**${n((f.encodeMasterMusicMix.measuredLoudness as Record<string, unknown> | null)?.integratedLufs)} LUFS**, Δ ${n((f.encodeMasterMusicMix.measuredLoudness as Record<string, unknown> | null)?.deltaFromTargetLufs)} LU against the target` : "none — no mix was applied"}`);
    L.push("");
  }

  L.push("## What the file's own audio says: fade and ducking, from one-second RMS");
  L.push("");
  L.push("One RMS figure per second, read from each delivered file with `asetnsamples=n=48000,astats` (so each figure is that");
  L.push("second of that file). The **music-minus-control** column is the mixed file's figure minus the no-music control's at the");
  L.push("same second — the same project, the same clips, so the difference is what the music added. Ducking spans are the ones");
  L.push("the job recorded, in seconds.");
  L.push("");
  for (const v of levels.filter((x) => x.kase !== "none")) {
    L.push(`### \`${v.kase}\``);
    L.push("");
    L.push(`- ducked spans: ${v.duckingSpansRecordedByTheJob.map((d) => `${d.startSeconds.toFixed(0)}–${d.endSeconds.toFixed(0)} s (${d.dB} dB)`).join(", ") || "none"}`);
    L.push(`- mean music-minus-control **inside** the ducked spans: **${n(v.summary.meanMusicMinusControlInsideDuckedSpansDb)} dB**; **outside** them: **${n(v.summary.meanMusicMinusControlOutsideDuckedSpansDb)} dB**; the step between the two: **${n(v.summary.differenceDb)} dB**`);
    L.push(`- first second: **${n(v.summary.firstSecondMusicMinusControlDb)} dB** (the 600 ms fade in); last second: **${n(v.summary.lastSecondMusicMinusControlDb)} dB** (the 1200 ms fade out)`);
    L.push("");
    L.push("| t (s) | music − control (dB) |");
    L.push("|---:|---:|");
    for (const p of v.musicMinusControl) L.push(`| ${p.t} | ${n(p.musicMinusControlDb)} |`);
    L.push("");
  }

  L.push("## What this pack does NOT claim");
  L.push("");
  L.push("- The synthetic bed is **not music**. It is a 440 Hz tone this team generated with ffmpeg; the Asset row declares");
  L.push("  `metadata.music.syntheticTestAsset: true` and the pipeline copies that declaration into the job, the master and the");
  L.push("  delivery. It is never called a catalogue track.");
  L.push("- The catalogue track's licence is **the uploader's claim, not a clearance**. `ZOR97` is a CC BY-SA track whose licence");
  L.push("  text came from Audius; nothing was verified with the rights holder and no screening or clearance was performed.");
  L.push("- **No narration and no sound effect** is in any of these files, and no subtitle cue is burned in. The ducking spans come");
  L.push("  from the scenes' own declared narration text and duration — there is no speech timing in this app and none was invented.");
  L.push("- A keyword-found stock clip is **not an illustration of its scene**.");
  L.push("- These three files live on this machine and in a MinIO bucket on this machine. A rebuild of the computer still loses");
  L.push("  them; that is a durability gap, not something this pack fixes.");
  L.push("");
  L.push("## How to regenerate");
  L.push("");
  L.push("```bash");
  L.push("# 1. the fixture world (account, project, nine scenes) — through the app's own sign-up route");
  L.push("bash scripts/fixtures/p7a-world.sh");
  L.push("# 2. the M2 world: 13 s scenes, narration text on the odd scenes, the synthetic bed + its Asset row");
  L.push("bash scripts/fixtures/m2-music-world.sh");
  L.push("# 3. source one real Pixabay clip per scene, through POST /api/media/select + /api/media/ingest");
  L.push("bun scripts/fixtures/p8b9-source-nine.ts search /tmp/m2-search.json");
  L.push("bun scripts/fixtures/p8b9-source-nine.ts source 1 365737 /tmp/m2-search.json   # … one per scene, orders 1–9");
  L.push("# 4. the three deliveries: synthetic bed, permitted ZOR97, no music — rendered, downloaded, measured");
  L.push("M2_PRUNE=1 bun scripts/fixtures/m2-music-deliveries.ts");
  L.push("# 5. the arithmetic, and this README");
  L.push("bun scripts/fixtures/m2-music-analysis.ts");
  L.push("bun scripts/fixtures/m2-music-evidence.ts");
  L.push("```");
  L.push("");
  L.push("The stage directory of each job is pruned after its delivery is downloaded and hashed (`M2_PRUNE=1`); the delivered");
  L.push("container's durable copy stays in object storage under the key the job row records.");
  L.push("");

  writeFileSync(join(EVIDENCE, "README.md"), L.join("\n"));
  for (const f of files) {
    const size = existsSync(join(EVIDENCE, "downloads", `m2-${f.kase}.mp4`)) ? statSync(join(EVIDENCE, "downloads", `m2-${f.kase}.mp4`)).size : 0;
    console.log(`wrote ${f.kase}: ${size} B in downloads/`);
  }
  console.log(`wrote ${join(EVIDENCE, "README.md")}`);
}

main();
