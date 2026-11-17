/**
 * BLOCK M2 — the music mix, its refusals, and the no-music guarantee.
 *
 * The one that matters most is the first group: with NO selection the pipeline
 * must behave exactly as it did before music could be mixed, and the mix plan
 * must produce no music input and no filter graph at all.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMusicMixGraph,
  musicFetchRefusal,
  musicInclusionSentence,
  narrationSpansFromScenes,
  parseEbur128Summary,
} from "../music-mix";
import { EXECUTORS } from "../executors";
import { DEFAULT_MIX } from "@/lib/music/ducking";
import { StageFailure, type ProjectFacts, type ProjectMusicFact, type RenderJobFacts } from "../types";

const PERMITTED_REASON =
  "Permitted by the uploader's stated CC licence; the licence claim has not been independently verified and attribution is required.";
const REFUSED_REASON = "non-commercial only";

function musicFact(over: Partial<ProjectMusicFact> = {}): ProjectMusicFact {
  return {
    assetId: "asset-1",
    provider: "audius",
    providerTrackId: "ZOR97",
    title: "Cinematic Animation",
    artist: "ONE ABE",
    artistHandle: "iamoneabe",
    durationSeconds: 56,
    attribution: "Cinematic Animation by ONE ABE — licence stated by the uploader: Attribution ShareAlike CC BY-SA.",
    licenceText: "Attribution ShareAlike CC BY-SA",
    verdict: {
      permitted: true,
      reason: PERMITTED_REASON,
      basis: "uploader-claimed",
      attributionRequired: true,
      licenceText: "Attribution ShareAlike CC BY-SA",
    },
    intendedUse: "commercial",
    permalink: "/iamoneabe/cinematic-animation-188956",
    volume: null,
    syntheticTestAsset: false,
    syntheticSourcePath: null,
    ...over,
  };
}

function facts(over: Partial<ProjectFacts> = {}): ProjectFacts {
  return {
    projectId: "proj-1",
    title: "A project",
    sceneCount: 2,
    scenes: [
      { id: "s1", order: 1, durationSeconds: 10, narrationChars: 40, subtitleCount: 0, assetCount: 1, sourcePath: "/tmp/a.mp4" },
      { id: "s2", order: 2, durationSeconds: 10, narrationChars: 0, subtitleCount: 0, assetCount: 1, sourcePath: "/tmp/b.mp4" },
    ],
    music: null,
    scriptChars: 40,
    subtitleCueCount: 0,
    sourceMediaCount: 2,
    ...over,
  };
}

const job = {
  id: "job-1",
  projectId: "proj-1",
  userId: "user-1",
  presetId: "youtube-1080p",
  presetLabel: "YouTube 1080p",
  presetSpec: null,
  presetSpecSha256: null,
  specVersion: null,
  fixture: false,
  syntheticProof: false,
  syntheticSource: null,
  requestedAt: new Date(0),
  startedAt: null,
  finishedAt: null,
  stopRequestedAt: null,
  stopReason: null,
  pipelineVersion: "render-pipeline/2",
} as unknown as RenderJobFacts;

/* ------------------------------------------------------------------ */
/* THE NO-MUSIC GUARANTEE                                              */
/* ------------------------------------------------------------------ */

describe("no music selected — nothing is added to the mix", () => {
  const plan = buildMusicMixGraph({
    music: null,
    bedSeconds: null,
    targetSeconds: 20,
    narration: [{ startMs: 0, endMs: 10000 }],
    sampleRateHz: 48000,
    channels: 2,
  });

  it("builds no filter graph and asks for no extra input arguments", () => {
    expect(plan.applied).toBe(false);
    expect(plan.filterComplex).toBeNull();
    expect(plan.inputArgs).toEqual([]);
    expect(plan.maps).toEqual([]);
    expect(plan.fit).toBe("not-applied");
    expect(plan.why).toContain("no music selection");
  });

  it("therefore leaves the encode argv exactly as it was: input, encode, mux, output", () => {
    // The encode stage's argv is ["-y","-hide_banner", ...inputArgs, ...musicArgs,
    // ...filterArgs, ...encode, ...mux, ...tuning, out]. With no music, musicArgs
    // and filterArgs are empty by construction — the same argv as before M2.
    const musicArgs = plan.applied && plan.filterComplex ? [...plan.inputArgs, "-i", "bed"] : [];
    const filterArgs = plan.applied && plan.filterComplex ? ["-filter_complex", plan.filterComplex, ...plan.maps] : [];
    expect(musicArgs).toEqual([]);
    expect(filterArgs).toEqual([]);
    const argv = ["-y", "-hide_banner", "-i", "concat.txt", "-c:v", "libx264", "-c:a", "aac", "-f", "mp4", "master.mp4"];
    const built = ["-y", "-hide_banner", "-i", "concat.txt", ...musicArgs, ...filterArgs, "-c:v", "libx264", "-c:a", "aac", "-f", "mp4", "master.mp4"];
    expect(built).toEqual(argv);
  });

  it("the fetch stage still runs, records musicSelected: false, and produces no file", async () => {
    const outcome = await EXECUTORS["music-fetch"]({
      job,
      facts: facts(),
      stageDir: mkdtempSync(join(tmpdir(), "music-none-")),
      artefacts: {},
    });
    expect(outcome.record.musicSelected).toBe(false);
    expect(outcome.record.bedFetched).toBe(false);
    expect(outcome.files).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* THE GATE                                                            */
/* ------------------------------------------------------------------ */

describe("a verdict that is not a permission", () => {
  const refused = musicFact({
    verdict: { permitted: false, reason: REFUSED_REASON, basis: "uploader-claimed", attributionRequired: false, licenceText: "CC BY-NC" },
  });

  it("is refused by music-fetch, quoting the gate's own reason verbatim", async () => {
    let thrown: unknown = null;
    try {
      await EXECUTORS["music-fetch"]({
        job,
        facts: facts({ music: refused }),
        stageDir: mkdtempSync(join(tmpdir(), "music-refused-")),
        artefacts: {},
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(StageFailure);
    const message = (thrown as Error).message;
    expect(message).toContain(REFUSED_REASON);
    expect(message).toContain("REFUSES");
    expect(message).not.toContain("Permitted by the uploader");
  });

  it("and the panel says the same thing before the button", () => {
    const sentence = musicInclusionSentence({ music: refused });
    expect(sentence).toContain("will NOT be mixed in");
    expect(sentence).toContain(REFUSED_REASON);
  });

  it("the refusal sentence and the gate's reason are the same string", () => {
    const sentence = musicFetchRefusal({ title: refused.title, artist: refused.artist, reason: refused.verdict.reason, basis: refused.verdict.basis });
    expect(sentence).toContain(`"${refused.verdict.reason}"`);
  });
});

/* ------------------------------------------------------------------ */
/* THE PANEL LINE                                                      */
/* ------------------------------------------------------------------ */

describe("the panel's music line", () => {
  it("says a delivery carries no music when nothing is selected", () => {
    expect(musicInclusionSentence({ music: null })).toContain("will carry no music");
  });

  it("says what will be mixed in, at the project's level, with the stored verdict quoted", () => {
    const sentence = musicInclusionSentence({ music: musicFact() });
    expect(sentence).toContain("Cinematic Animation — ONE ABE");
    expect(sentence).toContain(String(DEFAULT_MIX.musicVolume));
    expect(sentence).toContain(`${DEFAULT_MIX.fadeInMs} ms fade in`);
    expect(sentence).toContain(`${DEFAULT_MIX.fadeOutMs} ms fade out`);
    expect(sentence).toContain(PERMITTED_REASON);
    expect(sentence).toContain("has not been verified");
  });

  it("uses the project's own level when it set one", () => {
    expect(musicInclusionSentence({ music: musicFact({ volume: 0.35 }) })).toContain("volume 0.35");
  });
});

/* ------------------------------------------------------------------ */
/* THE MIX GRAPH                                                       */
/* ------------------------------------------------------------------ */

describe("the mix graph", () => {
  it("loops a bed shorter than the video, and says so", () => {
    const plan = buildMusicMixGraph({
      music: musicFact(),
      bedSeconds: 56,
      targetSeconds: 120.033,
      narration: [],
      sampleRateHz: 48000,
      channels: 2,
    });
    expect(plan.applied).toBe(true);
    expect(plan.fit).toBe("looped");
    expect(plan.fitSentence).toContain("LOOPED");
    expect(plan.inputArgs).toEqual(["-stream_loop", "-1"]);
    expect(plan.filterComplex).toContain("atrim=0:120.033");
  });

  it("trims a bed longer than the video, and says so", () => {
    const plan = buildMusicMixGraph({
      music: musicFact(),
      bedSeconds: 300,
      targetSeconds: 120.033,
      narration: [],
      sampleRateHz: 48000,
      channels: 2,
    });
    expect(plan.fit).toBe("trimmed");
    expect(plan.fitSentence).toContain("TRIMMED");
    expect(plan.inputArgs).toEqual([]);
  });

  it("carries the level and the fades from DEFAULT_MIX, plus an amix with the program audio", () => {
    const plan = buildMusicMixGraph({
      music: musicFact(),
      bedSeconds: 56,
      targetSeconds: 120,
      narration: [],
      sampleRateHz: 48000,
      channels: 2,
    });
    expect(plan.volume).toBe(DEFAULT_MIX.musicVolume);
    expect(plan.filterComplex).toContain(`volume=${DEFAULT_MIX.musicVolume}`);
    expect(plan.filterComplex).toContain("afade=t=in:st=0:d=0.6");
    expect(plan.filterComplex).toContain("afade=t=out:st=118.8:d=1.2");
    expect(plan.filterComplex).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(plan.maps).toEqual(["-map", "0:v:0", "-map", "[aout]"]);
  });

  it("ducks under narration when the project's scene rows give narration timing", () => {
    const narration = narrationSpansFromScenes([
      { durationSeconds: 10, narrationChars: 40 },
      { durationSeconds: 10, narrationChars: 0 },
    ]);
    expect(narration.spans).toEqual([{ startMs: 0, endMs: 10000 }]);
    const plan = buildMusicMixGraph({
      music: musicFact(),
      bedSeconds: 20,
      targetSeconds: 20,
      narration: narration.spans,
      sampleRateHz: 48000,
      channels: 2,
    });
    expect(plan.duckingApplied).toBe(true);
    expect(plan.ducking.length).toBeGreaterThan(0);
    expect(plan.filterComplex).toContain(`volume=volume=${-DEFAULT_MIX.duckedDepthDb}dB:enable='between(t,0,10)'`);
  });

  it("applies NO ducking when the project has no narration timing, and records the reason", () => {
    const narration = narrationSpansFromScenes([{ durationSeconds: 10, narrationChars: 0 }]);
    expect(narration.spans).toEqual([]);
    const plan = buildMusicMixGraph({
      music: musicFact(),
      bedSeconds: 10,
      targetSeconds: 10,
      narration: narration.spans,
      sampleRateHz: 48000,
      channels: 2,
    });
    expect(plan.duckingApplied).toBe(false);
    expect(plan.ducking).toEqual([]);
    expect(plan.duckingSentence).toContain("NO ducking is applied");
    expect(plan.filterComplex).not.toContain("enable=");
  });

  it("mixes nothing when the bed's length was never measured", () => {
    const plan = buildMusicMixGraph({
      music: musicFact(),
      bedSeconds: null,
      targetSeconds: 10,
      narration: [],
      sampleRateHz: 48000,
      channels: 2,
    });
    expect(plan.applied).toBe(false);
    expect(plan.filterComplex).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* ebur128                                                             */
/* ------------------------------------------------------------------ */

describe("ebur128 parsing", () => {
  const FIXTURE = `
[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         -21.4 LUFS
    Threshold: -31.7 LUFS

  Loudness range:
    LRA:         6.2 LU
    Threshold: -41.7 LUFS
    LRA low:   -26.3 LUFS
    LRA high:  -20.1 LUFS

  True peak:
    Peak:       -3.1 dBFS
`;

  it("reads the integrated loudness and true peak ffmpeg printed", () => {
    expect(parseEbur128Summary(FIXTURE)).toEqual({ integratedLufs: -21.4, truePeakDbfs: -3.1 });
  });

  it("answers null for a figure ffmpeg did not print, rather than estimating one", () => {
    expect(parseEbur128Summary("no summary here")).toEqual({ integratedLufs: null, truePeakDbfs: null });
  });
});

/* ------------------------------------------------------------------ */
/* A SYNTHETIC TEST ASSET is fetched, digested and labelled            */
/* ------------------------------------------------------------------ */

describe("a declared synthetic test asset", () => {
  it("is copied, digested, and labelled as synthetic — never as a catalogue track", async () => {
    const dir = mkdtempSync(join(tmpdir(), "music-synth-"));
    const bed = join(dir, "tone.wav");
    // A real 1-second 16-bit PCM WAV (silence), so ffprobe and ebur128 read an
    // actual audio file rather than a byte blob with a .wav name.
    const samples = 8000;
    const dataBytes = samples * 2;
    const wav = Buffer.alloc(44 + dataBytes, 0);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataBytes, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000 * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataBytes, 40);
    writeFileSync(bed, wav);
    const outcome = await EXECUTORS["music-fetch"]({
      job,
      facts: facts({
        music: musicFact({
          provider: "synthetic-test-asset",
          providerTrackId: "tone-440",
          title: "Synthetic test tone",
          artist: null,
          syntheticTestAsset: true,
          syntheticSourcePath: bed,
        }),
      }),
      stageDir: mkdtempSync(join(tmpdir(), "music-synth-stage-")),
      artefacts: {},
    });
    const record = outcome.record as Record<string, unknown>;
    expect(record.musicSelected).toBe(true);
    expect(record.syntheticTestAsset).toBe(true);
    expect(String(record.syntheticStatement)).toContain("SYNTHETIC TEST ASSET");
    const files = outcome.files ?? [];
    expect(files.length).toBe(1);
    expect(files[0].artefactKind).toBe("music-bed");
    expect(files[0].bytes).toBe(44 + 16000);
    expect(files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(files[0].path)).toBe(true);
  });
});
