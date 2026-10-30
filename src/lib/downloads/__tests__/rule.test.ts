/**
 * WHO MAY SEE WHICH ARTEFACT — the rule, driven directly (Phase 8, block 3).
 *
 * The download route is the one place where getting this wrong hands bytes over
 * instead of merely printing them, so the rule is tested as data rather than
 * through the route: a foreign row, a synthetic artefact, a synthetic job, a
 * synthetic project (by id and by title alone) and a deleted project all fail,
 * and a plain deliverable of the signed-in user passes.
 */
import { describe, expect, test } from "bun:test";
import {
  PRIMARY_ARTEFACT_KINDS,
  SIDECAR_ARTEFACT_KIND,
  deliverableArtefactWhere,
  deliverableWhereForUser,
  isDeliverableRow,
  proofWhereForUser,
  type ArtefactRuleRow,
} from "@/lib/downloads/rule";
import { SYNTHETIC_PROJECT_TITLE_PREFIX } from "@/lib/render/synthetic-projects";

const ME = "user_me";
const OTHER = "user_other";

function row(over: Partial<ArtefactRuleRow> & { job?: Partial<ArtefactRuleRow["job"]> } = {}): ArtefactRuleRow {
  const job = {
    id: "job_1",
    userId: ME,
    syntheticProof: false,
    project: { id: "prj_1", title: "The Future of Artificial Intelligence", deletedAt: null },
    ...(over.job ?? {}),
  };
  return { id: "art_1", kind: "delivered-container", syntheticProof: false, ...over, job };
}

describe("isDeliverableRow", () => {
  test("a plain deliverable of the signed-in user passes", () => {
    expect(isDeliverableRow(row(), ME)).toBe(true);
  });

  test("another account's artefact never passes, whatever else is true of it", () => {
    expect(isDeliverableRow(row({ job: { userId: OTHER } }), ME)).toBe(false);
  });

  test("an artefact row marked synthetic never passes — even with a normal job and project", () => {
    expect(isDeliverableRow(row({ syntheticProof: true }), ME)).toBe(false);
  });

  test("an artefact of a synthetic JOB never passes — the job's own marking is enough", () => {
    expect(isDeliverableRow(row({ job: { syntheticProof: true } }), ME)).toBe(false);
  });

  test("an artefact of a synthetic PROJECT fails by id and by title alone", () => {
    expect(isDeliverableRow(row({ job: { project: { id: "prj_syn", title: "Mine", deletedAt: null } } }), ME, ["prj_syn"])).toBe(false);
    expect(
      isDeliverableRow(
        row({ job: { project: { id: "prj_x", title: `${SYNTHETIC_PROJECT_TITLE_PREFIX} — 1920×1080 youtube-1080p`, deletedAt: null } } }),
        ME,
      ),
    ).toBe(false);
  });

  test("a deleted project's artefact does not pass", () => {
    expect(isDeliverableRow(row({ job: { project: { id: "prj_1", title: "Gone", deletedAt: new Date() } } }), ME)).toBe(false);
  });
});

describe("the Prisma where clauses say the same thing", () => {
  test("the user list forbids synthetic artefacts, synthetic jobs and synthetic projects", () => {
    const where = deliverableWhereForUser(ME, ["prj_syn"]);
    expect(where.syntheticProof).toBe(false);
    expect(where.job.userId).toBe(ME);
    expect(where.job.syntheticProof).toBe(false);
    expect(where.job.project.id.notIn).toEqual(["prj_syn"]);
    expect(where.job.project.NOT.title.startsWith).toBe(SYNTHETIC_PROJECT_TITLE_PREFIX);
    expect(where.kind.in).toEqual([...PRIMARY_ARTEFACT_KINDS]);
  });

  test("the direct-id clause is the list clause plus the id, so a route cannot relax it", () => {
    const where = deliverableArtefactWhere(ME, [], "art_9");
    expect(where.id).toBe("art_9");
    expect(where.syntheticProof).toBe(false);
    expect(where.job.syntheticProof).toBe(false);
    expect(where.job.userId).toBe(ME);
  });

  test("the proof read-out is the INVERSE rule: the marking is required, not forbidden", () => {
    const where = proofWhereForUser(ME, "art_p");
    expect(where.id).toBe("art_p");
    expect(where.syntheticProof).toBe(true);
    expect(where.job.syntheticProof).toBe(true);
    expect(where.job.userId).toBe(ME);
  });

  test("a sidecar is a different kind, so a list of deliverables never returns one", () => {
    expect(SIDECAR_ARTEFACT_KIND).toBe("checksum-sidecar");
    expect((PRIMARY_ARTEFACT_KINDS as readonly string[]).includes(SIDECAR_ARTEFACT_KIND)).toBe(false);
  });
});
