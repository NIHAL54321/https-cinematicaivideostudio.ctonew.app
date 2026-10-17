import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditPublishingPackage } from "../audit";
import { buildPublishingPackage, PUBLISHING_PACKAGE_FORMAT, sourceFingerprint } from "../package";
import { runPublishingAction, type PublishStore, type SavedPackage, type SavedPackageSummary } from "../service";
import { THUMBNAIL_CONCEPT_MINIMUM } from "../thumbnails";
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
    expect(pkg.block).toBe("P7-1..P7-5");
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
    // TWO entries have left this list, each because its block now builds the real
    // thing: `titles` when P7-3 landed, and `thumbnail_concepts` when P7-4 did. An
    // omission may only claim a later block for work this package does not carry.
    expect(ids).toEqual(["safety_screening", "creator_studio_workspace"]);
    // The invariant the removed thumbnail entry used to carry, stated for the whole
    // list: the registry-derived env var NAMES are applied to an entry that NEEDS a
    // provider, and to no other. Every entry here is built by this app's own rules.
    for (const entry of pkg.honesty.notInThisPackage) {
      expect(entry.reason.length).toBeGreaterThan(0);
      if (entry.needsProvider) expect(entry.envVars).toEqual(ENV);
      else expect(entry.envVars).toEqual([]);
    }
    // …and the work those two omissions described is now IN the package: the titles
    // with their model-backed part gated rather than claimed, and the thumbnail
    // concepts as traced specifications carrying no image at all.
    expect(pkg.titles.totalTitles).toBeGreaterThanOrEqual(pkg.titles.minimumRequested);
    expect(pkg.titles.categories).toHaveLength(6);
    expect(pkg.titles.modelPath.modelTitles).toEqual([]);
    expect(pkg.summary.titleOptions).toBe(pkg.titles.totalTitles);
    expect(pkg.thumbnails.totalConcepts).toBe(pkg.summary.thumbnailConcepts);
    expect(pkg.thumbnails.totalConcepts).toBeGreaterThanOrEqual(THUMBNAIL_CONCEPT_MINIMUM);
    // A measurement of the package's own concepts' image slots, not an assumption.
    expect(pkg.summary.thumbnailImagesProduced).toBe(0);
    expect(pkg.honesty.absentData.statement).toContain("no source of search-volume");
    expect(pkg.honesty.ruleCatalogue).toContain("rules.ts");
  });

  test("no gate names an env var the registry does not derive", () => {
    // A gate is the thing that prints an env var name, so this package is built the
    // way the publishing service builds it — with the facts the registry derives for
    // the thumbnail_generation capability. On a package that carries no gate there is
    // nothing to cross-check, which is why a WRONG expectation is caught on this one.
    const gate = {
      capability: "thumbnail_generation",
      envVars: ENV,
      wiredProviderIds: [],
      requirement: "A server operator enables it by setting the server-side env var OPENAI_API_KEY (names only).",
    };
    const pkg = buildPublishingPackage(richSource(), { ...OPTS, thumbnailImageGate: gate });
    const result = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ENV });
    expect(result.ok).toBe(true);
    // and a WRONG expectation is caught
    const wrong = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ["SOME_OTHER_KEY"] });
    expect(wrong.ok).toBe(false);
    expect(wrong.violations.some((v) => v.kind === "env_name_mismatch")).toBe(true);
    // The names really travelled: the plan's own statement about the image, and every
    // concept's image slot, name exactly the names the build was handed.
    expect(pkg.thumbnails.imageAbsence.envVars).toEqual(ENV);
    for (const concept of pkg.thumbnails.concepts) {
      expect(concept.image.state).toBe("gated_provider");
      if (concept.image.state === "gated_provider") expect(concept.image.envVars).toEqual(ENV);
    }
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

describe("the publishing service — the thumbnail_control action (P7-4)", () => {
  /** A package saved by the block BEFORE the concepts existed: no `thumbnails` key. */
  function storeWithAnOlderPackage() {
    const held = memoryStore({ proj_rich: richSource() });
    const older = buildPublishingPackage(richSource(), OPTS) as unknown as Record<string, unknown>;
    delete older.thumbnails;
    held.saved.push({ userId: "user_a", projectId: "proj_rich", pkg: older, derivedAt: older.derivedAt as string });
    return held;
  }

  test("nothing saved is a 409 that says to build one first", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    const result = await runPublishingAction(store, "user_a", { action: "thumbnail_control", projectId: "proj_rich", control: "regenerate" }, OPTS);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("no_package");
    expect(String(result.body.error)).toContain("Build one first");
  });

  test("a package saved before the concepts existed is a 409 naming that reason, not a crash", async () => {
    const { store } = storeWithAnOlderPackage();
    const result = await runPublishingAction(
      store,
      "user_a",
      { action: "thumbnail_control", projectId: "proj_rich", control: "regenerate" },
      OPTS,
    );
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("no_thumbnail_plan");
    expect(String(result.body.error)).toContain("carries no concept for a control to operate on");
  });

  test("a control with no name given yet is a 400, and an unknown control refuses without a 500", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    const missing = await runPublishingAction(store, "user_a", { action: "thumbnail_control", projectId: "proj_rich" }, OPTS);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("control_required");
    // A control id this app does not carry is a 400 with a machine-readable code —
    // never a thrown error and never a 200 carrying nothing.
    const unknown = await runPublishingAction(
      store,
      "user_a",
      { action: "thumbnail_control", projectId: "proj_rich", control: "make_it_viral" },
      OPTS,
    );
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("unknown_control");
    expect(String(unknown.body.error)).toContain("Unknown control. Expected one of:");
    expect(String(unknown.body.error)).toContain("change_composition");
  });

  test("a specification control returns a NEW concept through the route and saves nothing", async () => {
    const { store } = memoryStore({ proj_rich: richSource() });
    const built = await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    const concepts = (built.body.package as { thumbnails: { concepts: { id: string }[] } }).thumbnails.concepts;
    expect(concepts.length).toBeGreaterThanOrEqual(THUMBNAIL_CONCEPT_MINIMUM);
    const conceptId = concepts[0]!.id;

    const applied = await runPublishingAction(
      store,
      "user_a",
      { action: "thumbnail_control", projectId: "proj_rich", control: "change_background", conceptId },
      OPTS,
    );
    expect(applied.status).toBe(200);
    expect(applied.body.saved).toBe(false);
    expect(applied.body.wroteAFile).toBe(false);
    const outcome = applied.body.outcome as {
      status: string;
      rule: string;
      concept: { id: string; revisedFrom: string | null; image: { state: string } } | null;
      change: { field: string; conceptIdFrom: string; conceptIdTo: string; from: { textOrigin: string }; to: { textOrigin: string } } | null;
    };
    expect(outcome.status).toBe("applied");
    expect(outcome.concept).not.toBeNull();
    expect(outcome.concept!.id).not.toBe(conceptId);
    expect(outcome.concept!.revisedFrom).toBe(conceptId);
    expect(outcome.change!.field).toBe("background");
    expect(outcome.change!.conceptIdFrom).toBe(conceptId);
    expect(outcome.change!.conceptIdTo).toBe(outcome.concept!.id);
    expect(outcome.change!.from.textOrigin).toBe("rule_authored");
    expect(outcome.change!.to.textOrigin).toBe("rule_authored");
    // The revised concept still carries an ABSENT image, and nothing was written.
    expect(outcome.concept!.image.state).not.toBe("derived");
    // `note` is now the RENDERED view's own note (the panel prints it under the title),
    // so the transport prose that used to sit here moved to `transportNote` — see the
    // shape test below for why the body must carry both.
    expect(String(applied.body.transportNote)).toContain("nothing was saved");
    expect(String(applied.body.note)).not.toContain("nothing was saved");

    // and the seventh control, through the same route, refuses on the registry's own names
    const upscale = await runPublishingAction(
      store,
      "user_a",
      { action: "thumbnail_control", projectId: "proj_rich", control: "upscale", conceptId },
      OPTS,
    );
    expect(upscale.status).toBe(200);
    const up = upscale.body.outcome as { status: string; concept: unknown; change: unknown; refusal: { envVars: string[]; reason: string } | null };
    expect(up.status).toBe("refused_gated");
    expect(up.concept).toBeNull();
    expect(up.change).toBeNull();
    expect(up.refusal!.envVars.length).toBeGreaterThan(0);
    expect(up.refusal!.reason).toContain("nothing was enlarged");
  });

  /**
   * THE REGRESSION THAT 2a745d9 FIXED, AND WHY IT IS WRITTEN THIS WAY.
   *
   * Found by the live proof, not by grep: pressing a control on
   * /projects/<id>/creator-studio killed the page with "Application error: a
   * client-side exception has occurred". The route answered with the engine's own
   * `ThumbnailControlOutcome` under `outcome`, while the panel reads
   * kind / status / controlId / controlLabel / title / note / sections off the
   * response body — so `result.sections` was `undefined` and `.map()` threw during
   * render. The server's answer existed; the surface died on it. The block had even
   * BUILT the view (buildThumbnailControlResultView) and never wired it.
   *
   * A test that hard-codes the seven key names would pass again the moment the panel
   * grew an eighth key that the route never sends. So the required keys are READ OUT
   * OF THE PANEL'S OWN SOURCE — `result.<key>` inside ThumbnailControlCard and
   * nowhere else — and the route's answer must carry every one of them, for the
   * applied control and for the refusal. If the panel starts reading a new field, or
   * the route goes back to handing it the raw outcome, this fails.
   */
  test("the control answer is the view shape the panel reads — read out of the panel's own source, not hard-coded", async () => {
    const cardSource = readFileSync("src/app/(app)/projects/[id]/creator-studio/creator-studio-client.tsx", "utf8");
    const start = cardSource.indexOf("function ThumbnailControlCard");
    expect(start).toBeGreaterThan(-1);
    // The card ends where the next file-level banner begins ("The page").
    const end = cardSource.indexOf("/* -----", start);
    const card = cardSource.slice(start, end === -1 ? undefined : end);
    // Everything the card reads off the response body, and only that (the local
    // `result` state variable is the response body; `body.` prefixed reads are the
    // fetch's own shape and are not part of this contract).
    const keys = [...new Set([...card.matchAll(/\bresult\??\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))]
      .filter((k) => !["map", "filter", "length", "slice"].includes(k))
      .sort();
    // The extraction must be non-vacuous: these are the fields the crash was made of.
    expect(keys).toContain("kind");
    expect(keys).toContain("sections");
    expect(keys).toContain("controlId");
    expect(keys).toContain("title");
    expect(keys).toContain("note");

    const { store } = memoryStore({ proj_rich: richSource() });
    const built = await runPublishingAction(store, "user_a", { action: "build", projectId: "proj_rich" }, OPTS);
    const concepts = (built.body.package as { thumbnails: { concepts: { id: string }[] } }).thumbnails.concepts;
    const conceptId = concepts[0]!.id;

    const applied = await runPublishingAction(
      store,
      "user_a",
      { action: "thumbnail_control", projectId: "proj_rich", control: "change_background", conceptId },
      OPTS,
    );
    expect(applied.status).toBe(200);
    for (const key of keys) {
      expect({ key, own: Object.prototype.hasOwnProperty.call(applied.body, key), missing: applied.body[key] === undefined }).toEqual({
        key,
        own: true,
        missing: false,
      });
    }
    expect(applied.body.kind).toBe("thumbnail_control_result");
    expect(applied.body.status).toBe("applied");
    expect(applied.body.controlId).toBe("change_background");
    expect(applied.body.projectId).toBe("proj_rich");
    expect(Array.isArray(applied.body.sections)).toBe(true);
    expect((applied.body.sections as unknown[]).length).toBeGreaterThan(0);
    // The raw engine answer is kept ALONGSIDE the view, so the view can never hide
    // what the engine actually answered.
    expect((applied.body.outcome as { status: string }).status).toBe("applied");

    // The refusal travels through the same shape — it is not a special case the panel
    // has to know about, and it names the capability and the registry's env var names.
    const refused = await runPublishingAction(
      store,
      "user_a",
      { action: "thumbnail_control", projectId: "proj_rich", control: "upscale", conceptId },
      OPTS,
    );
    expect(refused.status).toBe(200);
    for (const key of keys) {
      expect({ key, own: Object.prototype.hasOwnProperty.call(refused.body, key), missing: refused.body[key] === undefined }).toEqual({
        key,
        own: true,
        missing: false,
      });
    }
    expect(refused.body.kind).toBe("thumbnail_control_result");
    expect(refused.body.status).toBe("refused_gated");
    expect(refused.body.controlId).toBe("upscale");
    expect((refused.body.sections as unknown[]).length).toBeGreaterThan(0);
    const refusedText = JSON.stringify(refused.body.sections);
    expect(refusedText).toContain("upscaling");
    expect(refusedText).toContain("nothing was enlarged");
    // A refusal carries NO concept: every section has empty rows, and no image record
    // of any kind — not an image, not a placeholder, not a state that could be read as
    // one. This is the assertion the "no picture exists" claim rests on.
    const refusalSections = refused.body.sections as { rows: unknown[] }[];
    expect(refusalSections.every((s) => s.rows.length === 0)).toBe(true);
    expect(refusedText).not.toContain('"image":');
  });

  test("another tenant cannot operate on this project's concepts", async () => {
    const { store } = storeWithAnOlderPackage();
    const result = await runPublishingAction(store, "user_b", { action: "thumbnail_control", projectId: "proj_rich", control: "regenerate" }, OPTS);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("not_found");
  });
});
