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
 * project has no source media without a media provider, and 2160p does not fit
 * in this machine's memory.
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
  /** Where that preset comes from: a shipped one, or a fixture-declared one. */
  presetOrigin: string;
  frame: string;
  codec: string;
  /** The pipeline's own verdict. */
  verdict: "produced a file" | "killed by the machine" | "refused before encoding";
  /** What was measured. */
  measured: string;
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
    presetOrigin: "a shipped preset (YouTube 1080p FHD SDR)",
    frame: "1920×1080 @ 30 fps",
    codec: "H.264 High @ level 4.0, yuv420p + AAC-LC 48 kHz stereo",
    verdict: "produced a file",
    measured:
      "all 7 pipeline stages SUCCEEDED in 2,532 ms (encode 2,117 ms, mux 361 ms, checksum 9 ms); " +
      "master 2,108,951 bytes sha256 6127a515…, delivered 2,109,388 bytes sha256 068c1b6b…, sidecar 192 bytes; " +
      "ffprobe on the delivered file: h264 High level 4.0, 1920×1080, 30/1, 8,214 kbps video, aac 48,000 Hz 2 ch 205 kbps, 2.005 s",
    evidence: "job cmvoxegje000dffg7sd3fk4y5 — 7 SUCCEEDED stage rows, 3 artefact rows, all syntheticProof=true",
  },
  {
    preset: "youtube-2160p",
    presetOrigin: "a shipped preset (YouTube 4K 2160p SDR)",
    frame: "3840×2160 @ 30 fps",
    codec: "H.265/HEVC Main @ level 5.1 (libx265), 45 Mbps target / 68 Mbps cap",
    verdict: "killed by the machine",
    measured:
      "the pipeline's encode-master stage FAILED after 4,087 ms (ffmpeg exited null — killed by a signal) and the job stopped at 45% with 0 artefacts; " +
      "re-running the stage's exact argv measured the cause: exit code 137 (SIGKILL) after 3,970 ms at a peak RSS of 1,288,600 kB (1.23 GB) against 1,167 MB available, no swap, 1.4 GB free on /",
    evidence: "job cmvoxc9xf000dffyka4wp578a — 4 SUCCEEDED stage rows, encode-master FAILED, 0 artefact rows",
  },
  {
    preset: "youtube-1440p",
    presetOrigin: "NOT a shipped preset — refused by the product's own catalogue rule",
    frame: "2560×1440 @ 30 fps",
    codec: "H.264 High @ level 5.0 (the level the matrix computed for 2560×1440×30)",
    verdict: "refused before encoding",
    measured:
      "the spec matrix refused a lower level verbatim (\"Level 4.2 does not cover 2560×1440 at 30 fps — the computed minimum is 5.0\"); " +
      "at level 5.0 the encode stage refused the job because no shipped preset delivers 2560×1440: " +
      "\"preset \\\"youtube-1440p\\\" is not in the export catalogue any more, so there is no specification to run\". 0 artefacts.",
    evidence: "job cmvoxbp95000dfft9blq638nq — 4 SUCCEEDED stage rows, encode-master FAILED, 0 artefact rows",
  },
] as const;

/** The resolutions a file was really produced at, from the runs above. */
export const RESOLUTIONS_PROVED: readonly string[] = ["1920×1080"];
/** The resolutions that were tried and did NOT produce a file, with the reason. */
export const RESOLUTIONS_NOT_PROVED: readonly { frame: string; why: string }[] = [
  { frame: "3840×2160", why: "killed by this machine's memory ceiling (SIGKILL at 1.23 GB peak RSS)" },
  { frame: "2560×1440", why: "no shipped preset delivers it, so the pipeline refused the job by its own catalogue rule" },
];

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
  presentSentence: ENCODER_PRESENT_SENTENCE,
  noProjectVideoSentence: NO_PROJECT_VIDEO_SENTENCE,
} as const;
