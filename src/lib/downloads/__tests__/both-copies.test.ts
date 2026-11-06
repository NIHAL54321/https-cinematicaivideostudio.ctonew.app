/**
 * BOTH COPIES ARE COUNTED (Phase 8, block 11).
 *
 * The defect: a delivered container that was on this machine AND stored durably
 * in object storage read only as `present`, and the summary counted one copy. The
 * durable copy the mux stage really made was invisible on the surface whose whole
 * job is to say what exists.
 *
 * So `state` still says which copy is SERVED (local first — that is what the
 * download route reads), and `copies` says where every copy IS. The four
 * combinations are driven here, in both directions:
 *
 *   local only    → copies "local",      1 present, 0 durable, summary names no durable copy
 *   durable only  → copies "durable",    0 present, 1 durable, download offered from storage
 *   both          → copies "local-and-durable", counted as present AND named as durable
 *   neither       → copies "none",       state "gone", no download offered
 */
import { describe, expect, test } from "bun:test";
import {
  deriveDownloadCentre,
  summarySentence,
  type ArtefactRow,
  type DiskFact,
} from "@/lib/downloads/centre";

const ME = "user_me";
const BYTES = 172_271_154;
const SHA = "a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22";
const KEY = "renders/user_me/job_1/delivered-container-a05f3f60fbd0d889.mp4";

function artefact(over: Partial<ArtefactRow> = {}): ArtefactRow {
  return {
    id: "art_1",
    jobId: "job_1",
    stageId: "mux",
    kind: "delivered-container",
    path: "/tmp/cavs-render-output/job_1/container-mux/delivered.mp4",
    bytes: BYTES,
    sha256: SHA,
    syntheticProof: false,
    createdAt: new Date("2026-11-06T18:13:44.015Z"),
    job: {
      id: "job_1",
      userId: ME,
      presetId: "youtube-1080p",
      presetLabel: "YouTube 1080p (FHD SDR)",
      syntheticProof: false,
      project: { id: "prj_1", title: "The tide gauge at Ardnish", deletedAt: null },
    },
    ...over,
  };
}

const onDisk: DiskFact = { present: true, diskBytes: BYTES, sizeMatches: true };
const offDisk: DiskFact = { present: false, diskBytes: null, sizeMatches: false };
const inStorage = { art_1: { key: KEY, bucket: "cinema-studio", objectBytes: BYTES } };

function derive(over: Partial<Parameters<typeof deriveDownloadCentre>[0]> = {}) {
  return deriveDownloadCentre({
    userId: ME,
    syntheticProjectIds: [],
    artefacts: [],
    sidecars: [],
    jobs: [],
    projects: [],
    disk: {},
    ...over,
  });
}

describe("the four combinations of local and durable copies", () => {
  test("LOCAL ONLY — present, no durable copy recorded, and the summary does not claim one", () => {
    const view = derive({ artefacts: [artefact()], disk: { art_1: onDisk } });
    const file = view.files[0];
    expect(file.state).toBe("present");
    expect(file.copies).toBe("local");
    expect(file.durableCopy).toBeNull();
    expect(view.counts).toMatchObject({ total: 1, present: 1, durable: 0, presentAndDurable: 0, localOnly: 1, gone: 0 });
    expect(view.summary).toContain("1 present on this machine only");
    expect(view.summary).not.toContain("also stored durably");
    expect(file.sentence).not.toContain("also stored durably");
  });

  test("DURABLE ONLY — not on disk, still downloadable from object storage, counted as durable", () => {
    const view = derive({ artefacts: [artefact()], disk: { art_1: offDisk }, durable: inStorage });
    const file = view.files[0];
    expect(file.state).toBe("durable");
    expect(file.copies).toBe("durable");
    expect(file.durableCopy?.key).toBe(KEY);
    expect(view.counts).toMatchObject({ present: 0, durable: 1, presentAndDurable: 0, gone: 0, bytesPresent: BYTES });
    expect(view.summary).toContain("1 stored durably in object storage only");
    expect(file.sentence).toContain("Not on this machine's disk");
  });

  test("BOTH — counted as present AND named as stored durably, which is the under-count this fixed", () => {
    const view = derive({ artefacts: [artefact()], disk: { art_1: onDisk }, durable: inStorage });
    const file = view.files[0];
    expect(file.state).toBe("present");
    expect(file.copies).toBe("local-and-durable");
    expect(file.durableCopy).not.toBeNull();
    expect(view.counts).toMatchObject({
      total: 1,
      present: 1,
      durable: 0,
      presentAndDurable: 1,
      localOnly: 0,
      gone: 0,
      // The bytes are counted ONCE, even though two copies exist.
      bytesPresent: BYTES,
    });
    expect(view.summary).toContain("1 on this machine (1 of them also stored durably in object storage)");
    expect(view.summary).toContain("one copy on disk, one in object storage");
    expect(file.sentence).toContain("On this machine");
    expect(file.sentence).toContain("also stored durably in this deployment's own object storage");
    expect(file.sentence).toContain(KEY);
  });

  test("NEITHER — gone, no download, and the recorded bytes are still stated", () => {
    const view = derive({ artefacts: [artefact()], disk: { art_1: offDisk } });
    const file = view.files[0];
    expect(file.state).toBe("gone");
    expect(file.copies).toBe("none");
    expect(file.durableCopy).toBeNull();
    expect(view.counts).toMatchObject({ present: 0, durable: 0, presentAndDurable: 0, gone: 1, bytesPresent: 0 });
    expect(view.summary).toContain("1 whose file is gone");
    expect(file.sentence).toContain("no longer on this machine");
  });

  test("a durable object at a DIFFERENT size is not the recorded file, so it is not counted", () => {
    const view = derive({
      artefacts: [artefact()],
      disk: { art_1: onDisk },
      durable: { art_1: { key: KEY, bucket: "cinema-studio", objectBytes: BYTES - 1 } },
    });
    expect(view.files[0].copies).toBe("local");
    expect(view.counts.presentAndDurable).toBe(0);
    expect(view.summary).not.toContain("also stored durably");
  });

  test("the summary is generated from the counts, so it cannot drift from them", () => {
    const view = derive({
      artefacts: [
        artefact(),
        artefact({ id: "art_2", jobId: "job_2" }),
        artefact({ id: "art_3", jobId: "job_3" }),
      ],
      disk: { art_1: onDisk, art_2: onDisk, art_3: offDisk },
      durable: { art_1: inStorage.art_1, art_3: { ...inStorage.art_1, key: KEY.replace("job_1", "job_3") } },
    });
    expect(view.counts).toMatchObject({ total: 3, present: 2, durable: 1, presentAndDurable: 1, localOnly: 1 });
    expect(view.summary).toBe(summarySentence(view.counts));
    expect(view.summary).toContain("3 artefact rows");
    expect(view.summary).toContain("2 on this machine (1 of them also stored durably in object storage)");
  });
});
