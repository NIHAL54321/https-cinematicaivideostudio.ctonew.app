/**
 * THE FOUR HONEST STATES, DERIVED (Phase 8, block 3).
 *
 * `deriveDownloadCentre` is a pure function over rows plus disk facts, so every
 * state this build can be in is driven here without a database or a server:
 *
 *   present  — the file is on this machine at the recorded size;
 *   gone     — the row exists, the file does not (what a machine reset does to
 *              /tmp/cavs-render-output — the state this machine is actually in);
 *   altered  — a file is there but not the recorded size, and is not offered;
 *   awaiting — a project with no file, with the reason taken from its own job's
 *              stage rows, including the missing input that stage named.
 *
 * And two negative controls: a synthetic artefact that reaches this function is
 * still dropped, and a sidecar is never listed as a file of its own.
 */
import { describe, expect, test } from "bun:test";
import {
  awaitingFromJob,
  deriveDownloadCentre,
  downloadFilename,
  fmtBytes,
  slugify,
  type ArtefactRow,
  type DiskFact,
} from "@/lib/downloads/centre";
import type { RenderReadout } from "@/lib/render/service";

const ME = "user_me";
const NOW = new Date("2026-10-26T10:00:00.000Z");

function artefact(over: Partial<ArtefactRow> = {}, jobOver: Partial<ArtefactRow["job"]> = {}): ArtefactRow {
  return {
    id: "art_1",
    jobId: "job_1",
    stageId: "mux",
    kind: "delivered-container",
    path: "/tmp/cavs-render-output/job_1/master.mp4",
    bytes: 13_055_542,
    sha256: "75f9b789" + "0".repeat(56),
    syntheticProof: false,
    createdAt: NOW,
    job: {
      id: "job_1",
      userId: ME,
      presetId: "youtube-1080p",
      presetLabel: "YouTube 1080p",
      syntheticProof: false,
      project: { id: "prj_1", title: "The Future of Artificial Intelligence", deletedAt: null },
      ...jobOver,
    },
    ...over,
  };
}

const presentFact: DiskFact = { present: true, diskBytes: 13_055_542, sizeMatches: true };
const goneFact: DiskFact = { present: false, diskBytes: null, sizeMatches: false };

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

describe("produced and present", () => {
  test("a file on disk at the recorded size is listed with its size, digest and a download", () => {
    const view = derive({ artefacts: [artefact()], disk: { art_1: presentFact } });
    expect(view.counts).toMatchObject({ total: 1, present: 1, gone: 0, altered: 0, bytesPresent: 13_055_542 });
    const file = view.files[0];
    expect(file.state).toBe("present");
    expect(file.href).toBe("/api/studio/downloads/art_1");
    expect(file.recordedBytes).toBe(13_055_542);
    expect(file.recordedSha256).toBe("75f9b789" + "0".repeat(56));
    expect(file.filename).toBe("the-future-of-artificial-intelligence--youtube-1080p--delivered.mp4");
    expect(file.sentence).toContain("The SHA-256 is checked against");
    expect(view.emptyState).toBeNull();
  });

  test("the sidecar is offered only when its own bytes are on disk too", () => {
    const sidecar = artefact({ id: "art_side", kind: "checksum-sidecar", path: "/tmp/cavs-render-output/job_1/master.mp4.sha256", bytes: 96 });
    const withSidecar = derive({
      artefacts: [artefact()],
      sidecars: [sidecar],
      disk: { art_1: presentFact },
      sidecarDisk: { art_side: { present: true, diskBytes: 96, sizeMatches: true } },
    });
    expect(withSidecar.files[0].sidecarHref).toBe("/api/studio/downloads/art_side/sidecar");
    expect(withSidecar.files[0].sidecarState).toBe("present");

    const sidecarGone = derive({
      artefacts: [artefact()],
      sidecars: [sidecar],
      disk: { art_1: presentFact },
      sidecarDisk: { art_side: goneFact },
    });
    expect(sidecarGone.files[0].sidecarHref).toBeNull();
    expect(sidecarGone.files[0].sidecarState).toBe("gone");
    expect(sidecarGone.files[0].sidecarBytes).toBe(96);
  });

  test("a sidecar row is never listed as a deliverable of its own", () => {
    const sidecar = artefact({ id: "art_side", kind: "checksum-sidecar" });
    const view = derive({ artefacts: [artefact(), sidecar], disk: { art_1: presentFact, art_side: presentFact } });
    expect(view.files.map((f) => f.artefactId)).toEqual(["art_1"]);
  });
});

describe("produced but gone", () => {
  test("the row is listed with its record, no download, and the reason names /tmp", () => {
    const view = derive({ artefacts: [artefact()], disk: { art_1: goneFact } });
    expect(view.counts).toMatchObject({ total: 1, present: 0, gone: 1, bytesPresent: 0 });
    const file = view.files[0];
    expect(file.state).toBe("gone");
    expect(file.recordedBytes).toBe(13_055_542);
    expect(file.sentence).toContain("/tmp/cavs-render-output");
    expect(file.sentence).toContain("no file is served in its place");
    // The route would answer 410 for this id — the page offers no link at all.
    expect(file.state).not.toBe("present");
  });

  test("an unchecked artefact can only ever be gone, never present", () => {
    const view = derive({ artefacts: [artefact()], disk: {} });
    expect(view.files[0].state).toBe("gone");
    expect(view.files[0].diskBytes).toBeNull();
  });

  test("a file that is not the recorded size is 'altered' and is not offered as present", () => {
    const view = derive({
      artefacts: [artefact()],
      disk: { art_1: { present: true, diskBytes: 1024, sizeMatches: false } },
    });
    expect(view.files[0].state).toBe("altered");
    expect(view.files[0].sentence).toContain("It is not served in this state.");
    expect(view.counts.altered).toBe(1);
  });
});

describe("synthetic proofs never enter the user's list", () => {
  test("a synthetic artefact row that reaches the derivation is dropped", () => {
    const view = derive({
      artefacts: [artefact({ id: "art_syn", syntheticProof: true })],
      disk: { art_syn: presentFact },
    });
    expect(view.files).toEqual([]);
    expect(view.counts.total).toBe(0);
  });

  test("an artefact of a synthetic job is dropped, even with a clean artefact row", () => {
    const view = derive({
      artefacts: [artefact({ job: { syntheticProof: true } })],
      disk: { art_1: presentFact },
    });
    expect(view.files).toEqual([]);
  });

  test("an artefact of a synthetic project is dropped by id and by title", () => {
    const byId = derive({
      artefacts: [artefact({ job: { project: { id: "prj_syn", title: "Mine", deletedAt: null } } })],
      syntheticProjectIds: ["prj_syn"],
      disk: { art_1: presentFact },
    });
    expect(byId.files).toEqual([]);

    const byTitle = derive({
      artefacts: [
        artefact({
          job: { project: { id: "prj_t", title: "SYNTHETIC ENCODER PROOF — 1920×1080 youtube-1080p", deletedAt: null } },
        }),
      ],
      disk: { art_1: presentFact },
    });
    expect(byTitle.files).toEqual([]);
  });

  test("another account's artefact is dropped", () => {
    const view = derive({ artefacts: [artefact({ job: { userId: "user_other" } })], disk: { art_1: presentFact } });
    expect(view.files).toEqual([]);
  });
});

describe("the empty state, and the reason a project has nothing", () => {
  const project = { id: "prj_1", title: "The Future of Artificial Intelligence" };

  function job(over: {
    status: RenderReadout["status"];
    stages?: Array<Partial<RenderReadout["stages"][number]>>;
    stopReason?: string | null;
  }): RenderReadout {
    return {
      job: {
        id: "job_9",
        projectId: "prj_1",
        projectTitle: project.title,
        presetId: "youtube-1080p",
        presetLabel: "YouTube 1080p",
        stopReason: over.stopReason ?? null,
        requestedAt: NOW.toISOString(),
        syntheticProof: false,
      },
      status: over.status,
      stages: (over.stages ?? []).map((s) => ({
        id: s.id ?? "encode",
        title: s.title ?? "Encode master",
        state: s.state ?? null,
        missingInput: s.missingInput ?? null,
        note: s.note ?? "",
        errorMessage: s.errorMessage ?? null,
      })),
    } as unknown as RenderReadout;
  }

  test("no render requested: the sentence names the missing input a media provider would supply", () => {
    const a = awaitingFromJob(null, project);
    expect(a.reasonCode).toBe("no-render");
    expect(a.sentence).toContain("No render has been requested for this project");
    expect(a.sentence).toContain("a project holds no source media until a media provider is connected");
  });

  test("a blocked job quotes the input its own stage named — never a generic reason", () => {
    const a = awaitingFromJob(
      job({ status: "blocked", stages: [{ state: "BLOCKED", missingInput: "0 of 9 scene(s) carry a source media file" }] }),
      project,
    );
    expect(a.reasonCode).toBe("blocked");
    expect(a.missingStage).toBe("encode");
    expect(a.missingInput).toBe("0 of 9 scene(s) carry a source media file");
    expect(a.sentence).toContain("0 of 9 scene(s) carry a source media file");
    expect(a.sentence).toContain("No file was produced");
  });

  test("a failed job quotes the stage's error; a stopped job names the stop", () => {
    const failed = awaitingFromJob(
      job({ status: "failed", stages: [{ state: "FAILED", errorMessage: "ffmpeg exited 1" }] }),
      project,
    );
    expect(failed.reasonCode).toBe("failed");
    expect(failed.sentence).toContain("ffmpeg exited 1");

    const stopped = awaitingFromJob(job({ status: "stopped", stopReason: "stop requested by the user" }), project);
    expect(stopped.reasonCode).toBe("stopped");
    expect(stopped.sentence).toContain("stop requested by the user");
  });

  test("a job that reports success with no artefact row says so instead of inventing a file", () => {
    const a = awaitingFromJob(job({ status: "succeeded" }), project);
    expect(a.reasonCode).toBe("succeeded-no-file");
    expect(a.sentence).toContain("recorded no artefact row");
    expect(a.sentence).toContain("none is invented to fill the gap");
  });

  test("the empty state appears only when there is genuinely nothing to download", () => {
    const empty = derive({ projects: [project], jobs: [] });
    expect(empty.emptyState).not.toBeNull();
    expect(empty.emptyState?.headline).toBe("Nothing has been produced for you yet, so there is nothing to download.");
    expect(empty.emptyState?.reason).toContain("a project holds no source media until a media provider is connected");
    expect(empty.emptyState?.note).toContain("a download centre that listed something you could not download would be lying");

    const withFile = derive({ artefacts: [artefact()], projects: [project], disk: { art_1: presentFact } });
    expect(withFile.emptyState).toBeNull();
  });

  test("a project with a produced file is not also listed as awaiting", () => {
    const view = derive({ artefacts: [artefact()], projects: [project], disk: { art_1: presentFact } });
    expect(view.awaiting).toEqual([]);
    expect(view.counts.projectsAwaiting).toBe(0);
  });
});

describe("filenames and sizes a person can read", () => {
  test("the filename names the project, the preset and what the file is", () => {
    expect(
      downloadFilename({ projectTitle: "The Future of AI!", presetId: "youtube-1080p", kind: "delivered-container", path: "/x/a.mp4" }),
    ).toBe("the-future-of-ai--youtube-1080p--delivered.mp4");
  });

  test("a synthetic proof's filename says so before a byte is written", () => {
    const name = downloadFilename({
      projectTitle: "SYNTHETIC ENCODER PROOF — 1920×1080",
      presetId: "youtube-1080p",
      kind: "master-video",
      path: "/x/master.mp4",
      synthetic: true,
    });
    expect(name.startsWith("SYNTHETIC-PROOF--")).toBe(true);
    expect(name.endsWith(".mp4")).toBe(true);
  });

  test("a sidecar is named as a .sha256 file and bytes are printed with separators", () => {
    expect(downloadFilename({ projectTitle: "P", presetId: "youtube-1080p", kind: "checksum-sidecar", path: "/x/a.mp4.sha256" })).toBe(
      "p--youtube-1080p--sha256.sha256",
    );
    expect(fmtBytes(13_055_542)).toBe("13,055,542 B");
    expect(fmtBytes(null)).toBe("—");
    expect(slugify("   ")).toBe("untitled");
  });
});
