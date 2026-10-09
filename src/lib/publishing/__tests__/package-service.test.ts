import { describe, expect, test } from "bun:test";
import { auditPublishingPackage } from "../audit";
import { buildPublishingPackage, PUBLISHING_PACKAGE_FORMAT, sourceFingerprint } from "../package";
import { runPublishingAction, type PublishStore, type SavedPackage, type SavedPackageSummary } from "../service";
import { emptySource, NOW, richSource } from "./fixtures";
import type { PublishingSource } from "../types";

const ENV = ["OPENAI_API_KEY"];

/** An in-memory store: the service is exercised with no database at all. */
function memoryStore(sources: Record<string, PublishingSource>, owner = "user_a") {
  const saved: { userId: string; projectId: string; pkg: unknown; derivedAt: string }[] = [];
  const store: PublishStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== owner) return null;
      const source = sources[projectId];
      return source ? { id: source.project.id, title: source.project.title } : null;
    },
    async loadSource(projectId) {
      return sources[projectId];
    },
    async savePackage({ userId, projectId, pkg }) {
      const version = saved.filter((s) => s.projectId === projectId).length + 1;
      // Round-trip through JSON, exactly as the Json column does.
      saved.push({ userId, projectId, pkg: JSON.parse(JSON.stringify(pkg)), derivedAt: pkg.derivedAt });
      return { id: `pkg_${version}`, version, derivedAt: pkg.derivedAt };
    },
    async latestPackage(projectId): Promise<SavedPackage | null> {
      const rows = saved.filter((s) => s.projectId === projectId);
      if (rows.length === 0) return null;
      const row = rows[rows.length - 1];
      return {
        id: `pkg_${rows.length}`,
        version: rows.length,
        derivedAt: row.derivedAt,
        sourceFingerprint: (row.pkg as { sourceFingerprint: string }).sourceFingerprint,
        format: PUBLISHING_PACKAGE_FORMAT,
        payload: row.pkg as SavedPackage["payload"],
        payloadBytes: JSON.stringify(row.pkg).length,
      };
    },
    async listPackages(projectId): Promise<SavedPackageSummary[]> {
      const rows = saved.filter((s) => s.projectId === projectId);
      return rows
        .map((row, i) => {
          const pkg = row.pkg as { summary: { chapters: number; scenes: number; assets: number; keywords: number; tags: number; hashtags: number; fields: { emptyNoInput: number } }; sourceFingerprint: string };
          return {
            id: `pkg_${i + 1}`,
            version: i + 1,
            derivedAt: row.derivedAt,
            sourceFingerprint: pkg.sourceFingerprint,
            counts: {
              chapters: pkg.summary.chapters,
              scenes: pkg.summary.scenes,
              assets: pkg.summary.assets,
              keywords: pkg.summary.keywords,
              tags: pkg.summary.tags,
              hashtags: pkg.summary.hashtags,
              emptyFields: pkg.summary.fields.emptyNoInput,
            },
          };
        })
        .reverse();
    },
  };
  return { store, saved };
}

const OPTS = { now: NOW, modelCopyEnvNames: ENV };

describe("the package — derived, traced and self-audited", () => {
  test("format, fingerprint and counts are all present and consistent", () => {
    const source = richSource();
    const pkg = buildPublishingPackage(source, OPTS);
    expect(pkg.format).toBe(PUBLISHING_PACKAGE_FORMAT);
    expect(pkg.kind).toBe("publishing_package");
    expect(pkg.block).toBe("P7-1");
    expect(pkg.sourceFingerprint).toBe(sourceFingerprint(source));
    expect(pkg.summary.chapters).toBe(pkg.chapters.chapterCount);
    expect(pkg.summary.keywords).toBe(pkg.keywords.totalKeywords);
    expect(pkg.summary.tags).toBe(pkg.tags.tagCount);
    expect(pkg.summary.hashtags).toBe(pkg.tags.hashtagCount);
    expect(pkg.summary.assets).toBe(pkg.assetLicences.counts.assets);
    expect(pkg.summary.fields.total).toBe(
      pkg.summary.fields.derived + pkg.summary.fields.emptyNoInput + pkg.summary.fields.gatedProvider,
    );
    expect(pkg.summary.fields.derived).toBeGreaterThan(0);
    expect(pkg.summary.fields.emptyNoInput).toBeGreaterThan(0);
  });

  test("the fingerprint changes when a source row changes and is stable when it does not", () => {
    const a = sourceFingerprint(richSource());
    const b = sourceFingerprint(richSource());
    expect(a).toBe(b);
    const changed = richSource();
    changed.chapters[0].scenes[0].durationSeconds = 121;
    expect(sourceFingerprint(changed)).not.toBe(a);
    const renamed = richSource();
    renamed.project.title = "The Fall of Carthage (revised)";
    expect(sourceFingerprint(renamed)).not.toBe(a);
  });

  test("the honesty block declares what is NOT in this package, with the registry env names", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const ids = pkg.honesty.notInThisPackage.map((e) => e.id);
    expect(ids).toEqual([
      "titles",
      "thumbnail_concepts",
      "quality_checker",
      "safety_screening",
      "creator_studio_workspace",
    ]);
    const titles = pkg.honesty.notInThisPackage.find((e) => e.id === "titles")!;
    expect(titles.needsProvider).toBe(true);
    expect(titles.envVars).toEqual(ENV);
    expect(titles.reason).toContain("P7-2");
    expect(pkg.honesty.absentData.statement).toContain("no source of search-volume");
    expect(pkg.honesty.ruleCatalogue).toContain("rules.ts");
  });

  test("no gate names an env var the registry does not derive", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const result = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ENV });
    expect(result.ok).toBe(true);
    // and a WRONG expectation is caught
    const wrong = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ["SOME_OTHER_KEY"] });
    expect(wrong.ok).toBe(false);
  });

  test("the package survives a JSON round trip and still audits clean", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const roundTripped = JSON.parse(JSON.stringify(pkg)) as unknown;
    const result = auditPublishingPackage(roundTripped, { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.violationCount).toBe(0);
  });

  test("a source with nothing to derive from still produces a clean package, not an error", () => {
    const pkg = buildPublishingPackage(emptySource(), OPTS);
    expect(pkg.chapters.block.state).toBe("empty_no_input");
    expect(pkg.assetLicences.counts.unknownUnverified).toBe(0);
    expect(pkg.selfAudit.ok).toBe(true);
  });
});

describe("the publishing service — build, read, list", () => {
  test("build derives from the project's rows and appends a saved version", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    const first = await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    expect(first.status).toBe(200);
    expect(first.body.saved).toBe(true);
    expect((first.body.persisted as { version: number }).version).toBe(1);
    const pkg = first.body.package as { chapters: { chapterCount: number } };
    expect(pkg.chapters.chapterCount).toBe(2);

    const second = await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    expect((second.body.persisted as { version: number }).version).toBe(2);
  });

  test("read returns the newest saved package and re-audits the stored bytes", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    const read = await runPublishingAction(store, "user_a", { action: "read", projectId: "proj_rich" }, OPTS);
    expect(read.status).toBe(200);
    expect(read.body.saved).toBe(true);
    const reAudit = read.body.reAudit as { ok: boolean; violationCount: number; inspectedKeys: number; format: string; expectedFormat: string };
    expect(reAudit.ok).toBe(true);
    expect(reAudit.violationCount).toBe(0);
    expect(reAudit.inspectedKeys).toBeGreaterThan(50);
    expect(reAudit.format).toBe(reAudit.expectedFormat);
    const payload = read.body.package as { format: string; sourceFingerprint: string };
    expect(payload.format).toBe(PUBLISHING_PACKAGE_FORMAT);
    expect((read.body.persisted as { payloadBytes: number }).payloadBytes).toBeGreaterThan(1000);
  });

  test("read on a project with nothing saved says so in words — it is not an error", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    const read = await runPublishingAction(store, "user_a", { action: "read", projectId: "proj_rich" }, OPTS);
    expect(read.status).toBe(200);
    expect(read.body.saved).toBe(false);
    expect(read.body.reason).toContain("No publishing package has been saved");
  });

  test("list returns the saved versions newest first, without the payloads", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    const list = await runPublishingAction(store, "user_a", { action: "list", projectId: "proj_rich" }, OPTS);
    expect(list.body.count).toBe(2);
    const versions = list.body.versions as { version: number; counts: { chapters: number } }[];
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].counts.chapters).toBe(2);
    expect(JSON.stringify(list.body)).not.toContain("sourceWeight");
  });

  test("another tenant's project is a 404, never a 403 and never a leak", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    for (const action of ["build", "read", "list"] as const) {
      const result = await runPublishingAction(store, "user_b", { action, projectId: "proj_rich" }, OPTS);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe("not_found");
    }
  });

  test("a missing project is a 404 for every action", async () => {
    const { store } = memoryStore({});
    const result = await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_nope" }, OPTS);
    expect(result.status).toBe(404);
  });

  test("bad input is rejected with a machine-readable code", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    expect((await runPublishingAction(store, "user_a", { action: "build" }, OPTS)).body.code).toBe("project_id_required");
    expect((await runPublishingAction(store, "user_a", { projectId: "proj_rich" }, OPTS)).body.code).toBe("unknown_action");
    expect((await runPublishingAction(store, "user_a", { action: "delete", projectId: "proj_rich" }, OPTS)).body.code).toBe(
      "unknown_action",
    );
  });

  test("the caller's call-to-action reaches the description and is attributed to the request", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    const result = await runPublishingAction(
      store,
      "user_a",
      { action: "build", projectId: "proj_rich", callToAction: "Which siege do you want next?" },
      OPTS,
    );
    const pkg = result.body.package as { description: { includedSections: string[]; text: { value: string } } };
    expect(pkg.description.includedSections).toContain("call_to_action");
    expect(pkg.description.text.value).toContain("Which siege do you want next?");
  });
});
