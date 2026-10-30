/**
 * WHAT THE ENCODER ON THIS BUILD CAN AND CANNOT DO — recorded, not guessed
 * (Phase 8, block 2b).
 *
 * Before block 2b the product told every reader that the machine had no
 * encoder, and that was true. `ffmpeg 7.0.2-static` is now installed (`/opt/ffmpeg-7.0.2`, linked at
 * `/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe`), and the pipeline's own
 * `encode-master` stage has produced real files. So the sentence had to change —
 * and it had to change to something NARROWER than "export works", because it is
 * still true that no project's video can be produced on this machine: a real
 * project has no source media without a media provider. 3840×2160 did NOT fit at
 * the shipped preset's default encoder settings (killed at 1.23 GB peak RSS) and
 * DID fit once the encoder's own thread/frame pool and lookahead were constrained
 * — a limit of those settings here, not of the frame size.
 *
 * This module is the ONE place those facts are written down, so no surface can
 * quietly drift from them. Every field is a measurement from a recorded run,
 * with the artefact it came from; nothing here is estimated. A test
 * (`encoder-facts.test.ts`) fails the build if any source file goes back to
 * claiming the encoder is absent, and if any copy claims a project or customer
 * video was produced.
 *
 * Client-safe: pure data and pure strings, no fs, no process, no env.
 */

/** The encoder that is actually installed, and where it came from. */
export const ENCODER_INSTALL = {
  binary: "ffmpeg",
  versionLine: "ffmpeg version 7.0.2-static (johnvansickle.com static build, libx265 + libx264 + libaom)",
  probeVersionLine: "ffprobe version 7.0.2-static",
  installDir: "/opt/ffmpeg-7.0.2",
  onPath: ["/usr/local/bin/ffmpeg", "/usr/local/bin/ffprobe"],
  /** The installed binaries' SHA-256, so "the same binary" is checkable. */
  sha256: {
    ffmpeg: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
    ffprobe: "4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d",
  },
  /** Runnability is decided by a live probe per render, never by this file. */
  runnabilitySource:
    "a live probe that spawns the binary and reads its exit code on every render job (src/lib/render/probes.ts) — not this constant, and never a cached boolean",
} as const;

/** One attempt at one resolution, through the pipeline's own stages. */
export interface EncoderProofRun {
  /** The preset the pipeline ran. */
  preset: string;
  /**
   * The RenderJob row this sentence came from. Every byte count and digest in
   * `measured` belongs to THIS job and no other — block 2b made three separate
   * 1080p proofs with different byte counts, so a number without its job id is
   * a number nobody can check.
   */
  jobId: string;
  /** Where that preset comes from: a shipped one, or a fixture-declared one. */
  presetOrigin: string;
  frame: string;
  codec: string;
  /** The pipeline's own verdict. */
  verdict: "produced a file" | "killed by the machine" | "refused before encoding";
  /** What was measured. */
  measured: string;
  /** Extra encoder arguments this attempt declared on the synthetic source; absent = the preset's own defaults. */
  encoderTuning?: string;
  /** The artefact or record the sentence came from. */
  evidence: string;
}

/**
 * THE THREE ATTEMPTS. Two were made on 2026-10-26 against
 * `/tmp/cavs-render-output/synthetic-encoder-proof/`, driven by
 * `scripts/fixtures/p8b2b-synthetic-encode.ts` (the 1440p one was refused by
 * the catalogue rule, and the 2160p one was killed by the machine).
 *
 * The source in every case is DECLARED and GENERATED — an ffmpeg `testsrc2`
 * pattern plus a 440 Hz sine, at the preset's own frame size and cadence, 60
 * frames, recorded on the job in its `syntheticSource` column with the file's
 * byte size and SHA-256. It is never a user's project, never the fixture
 * project, and never a delivered master.
 */
export const ENCODER_PROOF_RUNS: readonly EncoderProofRun[] = [
  {
    preset: "youtube-1080p",
    jobId: "cmvoxegje000dffg7sd3fk4y5",
    presetOrigin: "a shipped preset (YouTube 1080p FHD SDR)",
    frame: "1920×1080 @ 30 fps",
    codec: "H.264 High @ level 4.0, yuv420p + AAC-LC 48 kHz stereo",
    verdict: "produced a file",
    measured:
      "job cmvoxegje000dffg7sd3fk4y5: all 7 pipeline stages SUCCEEDED in 2,532 ms (encode 2,117 ms, mux 361 ms, checksum 9 ms); " +
      "THIS job's master 2,108,951 bytes sha256 6127a515…, its delivered file 2,109,388 bytes sha256 068c1b6b…, its sidecar 192 bytes; " +
      "ffprobe on the delivered file: h264 High level 4.0, 1920×1080, 30/1, 8,214 kbps video, aac 48,000 Hz 2 ch 205 kbps, 2.005 s. " +
      "Two OTHER 1080p proofs exist and their numbers are not merged into these: job cmvox5zpo000dff13oujat027 (delivered 2,116,354 bytes " +
      "sha256 9b724b31…) and job cmvoxiahh000fffskry022esk (delivered 2,116,306 bytes sha256 45de8c5e…) — three separate encodes, three " +
      "separate byte counts, each number carried by the job id it belongs to.",
    evidence: "job cmvoxegje000dffg7sd3fk4y5 — 7 SUCCEEDED stage rows, 3 artefact rows, all syntheticProof=true",
  },
  {
    preset: "youtube-2160p",
    jobId: "cmvoxc9xf000dffyka4wp578a",
    presetOrigin: "a shipped preset (YouTube 4K 2160p SDR) — FIRST attempt, the preset's own default encoder settings",
    frame: "3840×2160 (shipped preset defaults)",
    codec: "H.265/HEVC Main @ level 5.1 (libx265), 45 Mbps target / 68 Mbps cap",
    verdict: "killed by the machine",
    measured:
      "job cmvoxc9xf000dffyka4wp578a: the pipeline's encode-master stage FAILED after 4,087 ms (ffmpeg exited null — killed by a signal) " +
      "and the job stopped at 45% with 0 artefacts; " +
      "re-running the stage's exact argv measured the cause: exit code 137 (SIGKILL) after 3,970 ms at a peak RSS of 1,288,600 kB (1.23 GB) against 1,167 MB available, no swap, 1.4 GB free on /",
    evidence: "job cmvoxc9xf000dffyka4wp578a — 4 SUCCEEDED stage rows, encode-master FAILED, 0 artefact rows",
  },
  {
    preset: "youtube-2160p",
    jobId: "cmvoxscud000dffo7u3oki7cs",
    presetOrigin:
      "a shipped preset (YouTube 4K 2160p SDR) — SECOND attempt, under encoder settings DECLARED ON THE SYNTHETIC SOURCE; no preset was changed",
    frame: "3840×2160",
    codec: "H.265/HEVC Main (libx265), 45 Mbps target / 68 Mbps cap — the preset's own numbers, unchanged",
    verdict: "produced a file",
    encoderTuning: "-threads 2 -x265-params pools=1:frame-threads=1:rc-lookahead=5:bframes=2:ref=1",
    measured:
      "job cmvoxscud000dffo7u3oki7cs: all 7 pipeline stages SUCCEEDED in 30,467 ms (encode-master 28,872 ms, container-mux 1,517 ms, checksum 29 ms), 3 artefact rows; " +
      "peak ffmpeg RSS 1,168,860 kB (1,141 MB) against 1,228 MB available and no swap — it fitted, where the defaults (1,228,600 kB peak) did not; " +
      "master 13,055,105 bytes; delivered 13,055,542 bytes sha256 75f9b7894692bdec6155174c4edd2346a791ed233d134dec3a14d9e774b11b3a, " +
      "checksum sidecar recomputed from the file; ffprobe on the delivered file: hevc Main level 5.0 (150), 3840×2160, 30/1, 51,987,716 bps video, " +
      "aac LC 48 kHz stereo 205 kbps, 2.005 s. The preset DECLARES level 5.1 and the encoder wrote 5.0 — what the FILE says is recorded here, and the " +
      "declared value is not overwritten to match it (see MEASURED_ENCODE_OUTPUTS below).",
    evidence: "job cmvoxscud000dffo7u3oki7cs — 7 SUCCEEDED stage rows, 3 artefact rows, all syntheticProof=true",
  },
  {
    preset: "youtube-1440p",
    jobId: "cmvoxbp95000dfft9blq638nq",
    presetOrigin: "NOT a shipped preset — refused by the product's own catalogue rule",
    frame: "2560×1440 @ 30 fps",
    codec: "H.264 High @ level 5.0 (the level the matrix computed for 2560×1440×30)",
    verdict: "refused before encoding",
    measured:
      "job cmvoxbp95000dfft9blq638nq: the spec matrix refused a lower level verbatim (\"Level 4.2 does not cover 2560×1440 at 30 fps — the computed minimum is 5.0\"); " +
      "at level 5.0 the encode stage refused the job because no shipped preset delivers 2560×1440: " +
      "\"preset \\\"youtube-1440p\\\" is not in the export catalogue any more, so there is no specification to run\". 0 artefacts. " +
      "A second 1440p attempt (job cmvoxtkja000dff4i0epm4jdr) reached the same refusal word for word: nothing about 1440p has ever been encoded here.",
    evidence: "job cmvoxbp95000dfft9blq638nq — 4 SUCCEEDED stage rows, encode-master FAILED, 0 artefact rows",
  },
] as const;

/**
 * WHAT EACH RECORDED RUN ACTUALLY COST THIS MACHINE (Phase 8, block 4).
 *
 * The admin dashboard has to answer "do the shipped presets' settings fit this
 * machine?" on every request, and the only honest input to that question is a
 * peak RSS somebody measured. The numbers below are the ones already written in
 * `ENCODER_PROOF_RUNS` above, restated as fields so a surface can COMPARE them
 * with the memory available right now instead of re-typing prose:
 *
 *   - 1,228,600 kB is the peak from the FIRST youtube-2160p attempt, run at the
 *     shipped preset's own default encoder settings, which was killed (exit 137)
 *     with 1,167 MB available and no swap — see that run's `measured` sentence;
 *   - 1,168,860 kB is the peak from the SECOND attempt, the same preset and the
 *     same target numbers with the encoder's thread/frame pool and lookahead
 *     DECLARED on the synthetic source, which produced a file with 1,228 MB
 *     available.
 *
 * Both are measurements of the same frame size under two sets of encoder
 * settings, which is exactly why the fit verdict has four values and not two:
 * "fits", "does not fit", "fits only under declared tuning", and "unknown" for a
 * preset no run has ever attempted here. A preset with no recorded run is
 * UNKNOWN — never "fits", because nobody measured it.
 */
export interface PresetFitRecord {
  presetId: string;
  /** Which encoder settings the run used — the preset's own, or declared tuning. */
  settings: "the preset's own defaults" | "declared tuning on the synthetic source";
  /** Peak RSS the encoder process actually reached, in kB. */
  peakRssKb: number;
  outcome: "produced a file" | "killed by the machine";
  jobId: string;
  /** The measurement this row was read from. */
  basis: string;
}

export const PRESET_FIT_RECORD: readonly PresetFitRecord[] = [
  {
    presetId: "youtube-2160p",
    settings: "the preset's own defaults",
    peakRssKb: 1_228_600,
    outcome: "killed by the machine",
    jobId: "cmvoxc9xf000dffyka4wp578a",
    basis:
      "exit 137 (SIGKILL) after 3,970 ms at a peak RSS of 1,228,600 kB against 1,167 MB available, no swap",
  },
  {
    presetId: "youtube-2160p",
    settings: "declared tuning on the synthetic source",
    peakRssKb: 1_168_860,
    outcome: "produced a file",
    jobId: "cmvoxscud000dffo7u3oki7cs",
    basis:
      "peak ffmpeg RSS 1,168,860 kB against 1,228 MB available and no swap; the file was produced and measured",
  },
] as const;

/** The resolutions a file was really produced at, from the runs above. */
export const RESOLUTIONS_PROVED: readonly string[] = ["1920×1080", "3840×2160"];
/** The resolutions that were tried and did NOT produce a file, with the reason. */
export const RESOLUTIONS_NOT_PROVED: readonly { frame: string; why: string }[] = [
  {
    frame: "3840×2160 (shipped preset defaults)",
    why:
      "killed by this machine's memory ceiling (SIGKILL at 1.23 GB peak RSS) — the SAME resolution did produce a file once the encoder's own " +
      "thread/frame pool and lookahead were constrained, so this is a limit of the preset's default settings here, not of the frame size",
  },
  { frame: "2560×1440", why: "no shipped preset delivers it, so the pipeline refused the job by its own catalogue rule" },
];

/**
 * WHAT A FILE THE APP PRODUCED ACTUALLY MEASURES — a different fact from what
 * the specification declares, kept in a different place on purpose.
 *
 * The 2160p preset DECLARES HEVC Main at level 5.1. The file the pipeline
 * returned for it MEASURES level 5.0 (ffprobe `level=150`). Both are true, and
 * they are not the same sentence: 5.1 is what the specification asked the
 * encoder for; 5.0 is what the file carries. The product's rule is that a
 * declared value is NEVER presented as a measurement, and a measured value is
 * never quietly substituted into the specification to make them agree — so the
 * two live in separate tables and reach the screen through one builder
 * (`declaredVersusMeasured`) that labels each one.
 *
 * Every field here was read with ffprobe from the delivered file named by
 * `jobId`, and `probeFields` says which ffprobe fields it was read from so the
 * number can be re-derived by anyone.
 */
export interface MeasuredEncodeOutput {
  /** The preset whose specification produced the file. */
  presetId: string;
  /** The job the file belongs to — a synthetic encoder proof, never a project. */
  jobId: string;
  /** ffprobe's own codec name for the file's video stream. */
  codec: string;
  profile: string;
  /** The level THE FILE carries, in ffprobe's decimal form. */
  level: string;
  /** The same level as the raw integer ffprobe printed (`level=150` → 150). */
  levelRaw: number;
  /** Exactly which ffprobe fields these values were read from. */
  probeFields: string;
  frame: string;
  frameRate: string;
  videoBitrateBps: number;
  audio: string;
  durationSeconds: number;
  deliveredBytes: number;
  deliveredSha256: string;
  /** What was encoded — never a user's project. */
  encodedWhat: string;
}

export const MEASURED_ENCODE_OUTPUTS: readonly MeasuredEncodeOutput[] = [
  {
    presetId: "youtube-1080p",
    jobId: "cmvoxegje000dffg7sd3fk4y5",
    codec: "h264",
    profile: "High",
    level: "4.0",
    levelRaw: 40,
    probeFields: "codec_name, profile, level, width, height, r_frame_rate, bit_rate, duration (video stream) · codec_name, profile, sample_rate, channels, bit_rate (audio stream)",
    frame: "1920×1080",
    frameRate: "30/1",
    videoBitrateBps: 8214000,
    audio: "aac LC 48,000 Hz stereo 205 kbps",
    durationSeconds: 2.005,
    deliveredBytes: 2109388,
    deliveredSha256: "068c1b6b209d290696835bcb55dbcbad02c604d0cf5e8a32eb31b00aab23fb7e",
    encodedWhat: "a declared synthetic source (testsrc2 + 440 Hz sine) — not a project's video",
  },
  {
    presetId: "youtube-2160p",
    jobId: "cmvoxscud000dffo7u3oki7cs",
    codec: "hevc",
    profile: "Main",
    level: "5.0",
    levelRaw: 150,
    probeFields: "codec_name, profile, level, width, height, r_frame_rate, bit_rate, duration (video stream) · codec_name, profile, sample_rate, channels, bit_rate (audio stream)",
    frame: "3840×2160",
    frameRate: "30/1",
    videoBitrateBps: 51987716,
    audio: "aac LC 48,000 Hz stereo 205 kbps",
    durationSeconds: 2.005,
    deliveredBytes: 13055542,
    deliveredSha256: "75f9b7894692bdec6155174c4edd2346a791ed233d134dec3a14d9e774b11b3a",
    encodedWhat: "a declared synthetic source (testsrc2 + 440 Hz sine) — not a project's video",
  },
] as const;

/** The measurement for a preset, or null when nothing was measured at it. */
export function measuredOutputFor(presetId: string): MeasuredEncodeOutput | null {
  return MEASURED_ENCODE_OUTPUTS.find((m) => m.presetId === presetId) ?? null;
}

/** What the specification says — the input to the comparison, never the output. */
export interface DeclaredValue {
  presetId: string;
  codec: string;
  profile: string;
  level: string | null;
}

export type LevelRelation =
  | "identical"
  | "the file measures lower than declared"
  | "the file measures higher than declared"
  | "no measurement";

export interface DeclaredVersusMeasured {
  presetId: string;
  /** A sentence about the SPECIFICATION. Always labelled as declared. */
  declaredLine: string;
  /** A sentence about the FILE. Always labelled as measured, or null. */
  measuredLine: string | null;
  levelRelation: LevelRelation;
  /** Present only when the two levels differ, and says both, side by side. */
  divergenceSentence: string | null;
}

function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The one place a declared value and a measured value are put next to each
 * other. Pure: it takes the declared value and the recorded measurement as
 * arguments, so a test can hand it a tampered one of each and prove no value
 * can cross from one sentence into the other.
 */
export function buildDeclaredVersusMeasured(
  declared: DeclaredValue,
  measured: MeasuredEncodeOutput | null,
): DeclaredVersusMeasured {
  const declaredCodec = `${declared.codec} ${declared.profile}`.trim();
  const declaredLine =
    `DECLARED in the specification: ${declaredCodec}` +
    `${declared.level ? ` @ level ${declared.level}` : " (this codec declares no level)"} — ` +
    `the value this app resolves for preset "${declared.presetId}". It is a setting the encoder is asked for, not a measurement of any file.`;

  if (!measured) {
    return {
      presetId: declared.presetId,
      declaredLine,
      measuredLine: null,
      levelRelation: "no measurement",
      divergenceSentence: null,
    };
  }

  const measuredLine =
    `MEASURED with ffprobe on the file this build produced (job ${measured.jobId}; encoded ${measured.encodedWhat}): ` +
    `${measured.codec} ${measured.profile} @ level ${measured.level} (ffprobe level=${measured.levelRaw}), ${measured.frame}, ` +
    `${measured.frameRate} fps, ${group(measured.videoBitrateBps)} bps video, ${measured.audio}, ${measured.durationSeconds} s, ` +
    `${group(measured.deliveredBytes)} bytes, sha256 ${measured.deliveredSha256.slice(0, 16)}… — read from ffprobe's ` +
    `${measured.probeFields}.`;

  const declaredLevel = declared.level;
  const levelRelation: LevelRelation =
    declaredLevel === null
      ? "no measurement"
      : declaredLevel === measured.level
        ? "identical"
        : Number(measured.level) < Number(declaredLevel)
          ? "the file measures lower than declared"
          : "the file measures higher than declared";

  const divergenceSentence =
    declaredLevel === null || levelRelation === "identical"
      ? null
      : `The specification declares level ${declaredLevel} and the file measures level ${measured.level} ` +
        `(ffprobe level=${measured.levelRaw}) — ${levelRelation}. Both sentences are true and they are different facts: ` +
        `${declaredLevel} is what the specification asked the encoder for, ${measured.level} is what the file it returned carries. ` +
        `Neither number is corrected to match the other, and the preset is not rewritten to make the pair agree.`;

  return {
    presetId: declared.presetId,
    declaredLine,
    measuredLine,
    levelRelation,
    divergenceSentence,
  };
}

/** The recorded measurement for this preset, compared to what it declares. */
export function declaredVersusMeasured(declared: DeclaredValue): DeclaredVersusMeasured {
  return buildDeclaredVersusMeasured(declared, measuredOutputFor(declared.presetId));
}

/**
 * THE SENTENCE NO SURFACE MAY WIDEN: an encoder is here, a file was produced
 * from a declared synthetic source — and no project's video has been produced.
 */
export const NO_PROJECT_VIDEO_SENTENCE =
  "No project video has been produced on this build. A real project has no source media without a media provider, so the pipeline's " +
  "encode stage reports that and stops; the files that do exist are encodes of a declared synthetic source, labelled as such on the job, " +
  "the stage rows and the artefact rows.";

/** What the encoder's presence changes, in one sentence, for any surface. */
export const ENCODER_PRESENT_SENTENCE =
  `An encoder is installed on this build (${ENCODER_INSTALL.versionLine}) and the render pipeline's own encode stage has produced real files ` +
  `from a declared synthetic source at ${RESOLUTIONS_PROVED.join(", ")}. It is not a project's video: ${NO_PROJECT_VIDEO_SENTENCE}`;

/** Everything a surface needs to render the encoder's state without inventing a word. */
export const ENCODER_STATE = {
  install: ENCODER_INSTALL,
  runs: ENCODER_PROOF_RUNS,
  proved: RESOLUTIONS_PROVED,
  notProved: RESOLUTIONS_NOT_PROVED,
  measuredOutputs: MEASURED_ENCODE_OUTPUTS,
  presentSentence: ENCODER_PRESENT_SENTENCE,
  noProjectVideoSentence: NO_PROJECT_VIDEO_SENTENCE,
} as const;
