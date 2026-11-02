/**
 * THE GUARDS ON A REAL-FOOTAGE RENDER (Phase 8, block 7b).
 *
 * Three things could quietly go wrong the first time a project's own footage
 * reaches the encoder, and each of them would produce a file that looks fine:
 *
 *   1. A PARTIAL TIMELINE DELIVERED AS THE PROJECT. Until this block the encode
 *      stage filtered out the scenes without media and encoded the rest, so a
 *      project with 1 of 9 scenes sourced produced a one-scene master under the
 *      project's name. The first test is the negative control for exactly that
 *      behaviour: it fails against the old code, which would have gone on to
 *      build a concat list.
 *   2. SEGMENTS THAT DO NOT MATCH. The concat demuxer stitches streams that must
 *      share codec parameters; a stock clip arrives at the provider's resolution
 *      and cadence, sometimes with no audio at all. The normalisation plan is
 *      derived from the preset, and the audio decision is stated rather than
 *      assumed.
 *   3. A FILE THAT MISDESCRIBES ITSELF. The delivery is stock footage edited by
 *      this pipeline — not synthetic, not AI-generated, with no narration, music
 *      or subtitles — and the comment it carries must be generated from the
 *      scenes' own rows.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTORS, frameRateValue } from "../executors";
import { findExportPreset, resolvedSpecCore } from "@/lib/export/presets";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";
import { PIPELINE_VERSION } from "../pipeline";
import { SYNTHETIC_MARKER } from "../synthetic-source";
import { deliveryProvenance } from "../delivery-provenance";
import { planClipNormalisation, sourcePathKind, timelineTargetFromSpec } from "../source-clip";
import type { ProjectFacts, RenderJobFacts, RenderSceneFact, StageExecContext } from "../types";

const PRESET = findExportPreset("youtube-1080p");
if (!PRESET) throw new Error("the 1080p preset this test is written against is missing from the catalogue");

function job(): RenderJobFacts {
  return {
    id: "job-real-1",
    projectId: "proj-real-1",
    userId: "user-1",
    presetId: PRESET!.id,
    presetLabel: PRESET!.label,
    presetSpec: resolvedSpecCore(PRESET!),
    presetSpecSha256: sha256OfJson(resolvedSpecCore(PRESET!)),
    specVersion: PRESET!.specVersion,
    pipelineVersion: PIPELINE_VERSION,
    fixture: false,
    syntheticProof: false,
    syntheticSource: null,
    requestedAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    stopRequestedAt: null,
    stopReason: null,
  };
}

function scene(order: number, sourcePath: string | null, extra: Partial<RenderSceneFact> = {}): RenderSceneFact {
  return {
    id: `sc${order}`,
    order,
    durationSeconds: 10,
    narrationChars: 0,
    subtitleCount: 0,
    assetCount: sourcePath ? 1 : 0,
    sourcePath,
    source: sourcePath
      ? {
          pathKind: sourcePathKind(sourcePath),
          storedBytes: 11_749_650,
          storedSha256: "0eb6160".padEnd(64, "0"),
          provider: "pixabay",
          providerAssetId: "3713",
          pageUrl: "https://pixabay.com/videos/id-3713/",
          author: "bellergy",
          licenseType: "ROYALTY_FREE",
          licenseSource: "Pixabay",
          licenseUrl: "https://pixabay.com/service/terms/",
          attribution: "bellergy via Pixabay",
          purchasedAt: null,
          expiresAt: null,
        }
      : null,
    ...extra,
  };
}

function facts(scenes: RenderSceneFact[]): ProjectFacts {
  return {
    projectId: "proj-real-1",
    title: "A project title that comes from the project",
    sceneCount: scenes.length,
    scenes,
    scriptChars: 0,
    subtitleCueCount: 0,
    sourceMediaCount: scenes.filter((s) => s.sourcePath).length,
  };
}

function ctxFor(f: ProjectFacts, stageDir: string): StageExecContext {
  return { job: job(), facts: f, stageDir, artefacts: {} };
}

describe("a partial timeline is never delivered as the project's video", () => {
  test("encode-master REFUSES a real job when 1 of 9 scenes has no source, and names it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-p8rf-guard-"));
    try {
      // Scene 4 has no asset. The old code filtered it out and encoded the other
      // eight; that is the behaviour this test exists to make impossible.
      const scenes = Array.from({ length: 9 }, (_, i) => scene(i + 1, i + 1 === 4 ? null : `/tmp/never-used-${i + 1}.mp4`));
      let message = "";
      let threw = false;
      try {
        await EXECUTORS["encode-master"](ctxFor(facts(scenes), dir));
      } catch (err) {
        threw = true;
        message = (err as Error).message;
      }
      expect(threw).toBe(true);
      // The refusal names the count, the scene, and why a shorter master is not
      // the project's video.
      expect(message).toContain("REFUSES");
      expect(message).toContain("1 of 9 scene(s) carry no source media");
      expect(message).toContain("#4 (sc4)");
      expect(message).toContain("would be delivered as the project's video");
      // Nothing was written: no concat list, no master.
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a scene with no source at all is refused before anything else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-p8rf-guard2-"));
    try {
      const scenes = [scene(1, null), scene(2, null)];
      let message = "";
      try {
        await EXECUTORS["encode-master"](ctxFor(facts(scenes), dir));
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("2 of 2 scene(s) carry no source media");
      expect(message).toContain("#1 (sc1)");
      expect(message).toContain("#2 (sc2)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a scene whose asset is only a provider URL is refused, not fetched mid-encode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-p8rf-url-"));
    try {
      const scenes = [scene(1, "https://cdn.pixabay.com/video/2016/07/05/3713-173505175_large.mp4")];
      let message = "";
      try {
        await EXECUTORS["encode-master"](ctxFor(facts(scenes), dir));
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("has only a provider URL as its source");
      expect(message).toContain("does not fetch footage from a provider's CDN mid-encode");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("where a source path points, and how it is read", () => {
  test("an object key, an absolute path and a URL are three different things", () => {
    expect(sourcePathKind("footage/user1/asset-0eb6160a1b2c3d4e.mp4")).toBe("object-key");
    expect(sourcePathKind("/tmp/cavs-render-output/synthetic-encoder-proof/sources/x.mp4")).toBe("local-path");
    expect(sourcePathKind("https://cdn.pixabay.com/video/3713.mp4")).toBe("url");
    expect(sourcePathKind("http://example.test/a.mp4")).toBe("url");
  });
});

describe("the timeline target comes from the job's preset, not from a typed-in number", () => {
  const target = timelineTargetFromSpec(PRESET!);

  test("every parameter is traceable to the preset", () => {
    expect(target.widthPx).toBe(PRESET!.widthPx);
    expect(target.heightPx).toBe(PRESET!.heightPx);
    expect(target.frameRate).toBe(PRESET!.video.frameRate);
    expect(target.pixelFormat).toBe(PRESET!.video.pixelFormat);
    expect(target.sampleRateHz).toBe(PRESET!.audio.sampleRateHz);
    expect(target.channels).toBe(PRESET!.audio.channels);
    expect(target.basis.length).toBeGreaterThanOrEqual(6);
    for (const b of target.basis) expect(b.from).toContain(PRESET!.id);
  });

  test("a clip is fitted inside the frame, never cropped to it", () => {
    const plan = planClipNormalisation({ inputPath: "/in.mp4", outputPath: "/out.mp4", target, sourceHasAudio: true });
    expect(plan.videoFilter).toContain("force_original_aspect_ratio=decrease");
    expect(plan.videoFilter).toContain(`pad=${target.widthPx}:${target.heightPx}`);
    expect(plan.videoFilter).toContain(`fps=${target.frameRate}`);
    expect(plan.videoFilter).toContain(`format=${target.pixelFormat}`);
    expect(plan.videoFilter).not.toContain("crop");
    // The argv really carries the derived filter, and the output path is last.
    expect(plan.argv[plan.argv.indexOf("-vf") + 1]).toBe(plan.videoFilter);
    expect(plan.argv[plan.argv.length - 1]).toBe("/out.mp4");
  });

  test("a clip WITH audio keeps its own audio, re-encoded to the preset's layout", () => {
    const plan = planClipNormalisation({ inputPath: "/in.mp4", outputPath: "/out.mp4", target, sourceHasAudio: true });
    expect(plan.audio.plan).toBe("clip-audio-kept");
    expect(plan.argv.join(" ")).toContain("-map 0:a:0");
    expect(plan.argv.join(" ")).not.toContain("anullsrc");
    expect(plan.argv.join(" ")).toContain(`-ar ${target.sampleRateHz}`);
    expect(plan.argv.join(" ")).not.toContain("-shortest");
    expect(plan.audio.statement).toContain("carries an audio stream");
  });

  test("a clip with NO audio gets a silent track, deliberately and stated", () => {
    const plan = planClipNormalisation({ inputPath: "/in.mp4", outputPath: "/out.mp4", target, sourceHasAudio: false });
    expect(plan.audio.plan).toBe("silent-track-added");
    expect(plan.argv.join(" ")).toContain("anullsrc=channel_layout=stereo");
    expect(plan.argv.join(" ")).toContain("-map 1:a:0");
    // Without -shortest the silent generator would run forever.
    expect(plan.argv.join(" ")).toContain("-shortest");
    expect(plan.audio.statement).toContain("carries NO audio stream");
    expect(plan.audio.statement).toContain("silent AAC");
  });

  test("ffprobe's frame-rate ratio is read, not guessed", () => {
    expect(frameRateValue("30/1")).toBe(30);
    expect(frameRateValue("30000/1001")).toBeCloseTo(29.97, 2);
    expect(frameRateValue("0/0")).toBeNull();
    expect(frameRateValue(null)).toBeNull();
    expect(frameRateValue("nonsense")).toBeNull();
  });
});

describe("what the delivered file is allowed to say about itself", () => {
  const factsOne = facts([scene(1, "footage/user1/asset-0eb6160a1b2c3d4e.mp4")]);
  const prov = deliveryProvenance(factsOne);

  test("it is not AI-generated and says so, and never claims the synthetic marker", () => {
    expect(prov.comment).toContain("Not AI-generated");
    expect(prov.comment).toContain("no image or video model produced any frame");
    expect(prov.comment).not.toContain(SYNTHETIC_MARKER);
  });

  test("the credit comes from the rows: provider, id, author, page and licence", () => {
    expect(prov.providers).toEqual(["pixabay"]);
    expect(prov.comment).toContain("pixabay id 3713 by bellergy");
    expect(prov.comment).toContain("https://pixabay.com/videos/id-3713/");
    expect(prov.comment).toContain("licence ROYALTY_FREE per Pixabay (https://pixabay.com/service/terms/)");
    expect(prov.everySceneHasProvenance).toBe(true);
  });

  test("it does not invent a purchase date or an expiry the provider never stated", () => {
    expect(prov.sources[0].purchasedAt).toBeNull();
    expect(prov.sources[0].expiresAt).toBeNull();
    expect(prov.comment).toContain("no purchase and no expiry stated by the provider");
    expect(prov.comment).not.toMatch(/purchased on/i);
  });

  test("it states the narration, music, subtitles and screening it does NOT have", () => {
    expect(prov.comment).toContain("No narration");
    expect(prov.comment).toContain("No music or sound effects");
    expect(prov.comment).toContain("No subtitles");
    expect(prov.comment).toContain("No screening or clearance was performed");
  });

  test("a scene with no provenance row is named as such instead of being silently credited", () => {
    const mixed = deliveryProvenance(facts([scene(1, "/tmp/a.mp4"), { ...scene(2, "/tmp/b.mp4"), source: null }]));
    expect(mixed.everySceneHasProvenance).toBe(false);
    expect(mixed.comment).toContain("scene #2: no provider is recorded on this scene's asset");
  });

  test("the same provenance is generated for every scene of a multi-scene project", () => {
    const three = deliveryProvenance(facts([scene(1, "/tmp/a.mp4"), scene(2, "/tmp/b.mp4"), scene(3, "/tmp/c.mp4")]));
    expect(three.sources.length).toBe(3);
    for (const o of [1, 2, 3]) expect(three.comment).toContain(`scene #${o}: pixabay id 3713 by bellergy`);
  });
});
