/**
 * THE EXCLUSIONS ARE NOT OPTIONAL — a guard that fails when a new surface forgets
 * them (Phase 8, block 3).
 *
 * Block 2b's rule is: a synthetic encoder proof is never presented as a user's own
 * file. Block 3 adds the surfaces where that matters most — a LIST of deliverables
 * and a DOWNLOAD of one — so the rule lives in `src/lib/downloads/rule.ts` and
 * every reader of `RenderArtefact` has to go through it.
 *
 * This test reads the source tree and fails on three kinds of forgetting:
 *
 *   1. a file that READS artefacts (`prisma.renderArtefact.findMany/findFirst`)
 *      without importing the rule — so a new list cannot be added unfiltered;
 *   2. a download/proof ROUTE that does not go through `@/lib/downloads/*` — so a
 *      new route cannot restate (or drop) the rule;
 *   3. any file under `src/app` that writes its own `syntheticProof: false`
 *      literal — the exclusion is expressed ONCE, in rule.ts, and a surface that
 *      copies it is one edit away from disagreeing with it.
 *
 * A deliberate exception is allowed only by naming the file and the reason here.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "src");

/** The only file allowed to READ artefacts without the rule: it writes them. */
const READ_ALLOWED = new Map<string, string>([
  ["lib/render/store.ts", "the writer — it creates artefact rows and lists none to a user"],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT).map((full) => ({ rel: relative(ROOT, full), src: readFileSync(full, "utf8") }));

const READS_ARTEFACTS = /prisma\.renderArtefact\.(findMany|findFirst|findUnique|count)\s*\(/;

/** The rule may be imported absolutely or from inside src/lib/downloads. */
const IMPORTS_RULE = /@\/lib\/downloads\/rule|from\s+["']\.{1,2}\/rule["']/;

describe("every reader of RenderArtefact applies the rule", () => {
  test("a file that lists artefacts imports @/lib/downloads/rule", () => {
    const readers = files.filter((f) => READS_ARTEFACTS.test(f.src));
    // The guard is only meaningful if it found the readers it is guarding.
    expect(readers.length).toBeGreaterThan(0);
    const offenders = readers
      .filter((f) => !READ_ALLOWED.has(f.rel))
      .filter((f) => !IMPORTS_RULE.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test("the allowlist is honest: the writer really does not read artefacts for a user", () => {
    for (const [rel, why] of READ_ALLOWED) {
      const file = files.find((f) => f.rel === rel);
      expect(file).toBeDefined();
      expect(why.length).toBeGreaterThan(10);
      // It writes: createMany/create/upsert must appear.
      expect(file!.src).toMatch(/renderArtefact\.(create|createMany|upsert)/);
    }
  });
});

describe("every download surface goes through the shared rule and server", () => {
  const surfaces = files.filter(
    (f) => f.rel.startsWith("app/api/studio/downloads") || f.rel.startsWith("app/api/studio/proofs"),
  );

  test("the routes that exist are exactly the ones this block built", () => {
    expect(surfaces.map((f) => f.rel).sort()).toEqual([
      "app/api/studio/downloads/[artefactId]/route.ts",
      "app/api/studio/downloads/[artefactId]/sidecar/route.ts",
      "app/api/studio/downloads/route.ts",
      "app/api/studio/proofs/[artefactId]/route.ts",
      "app/api/studio/proofs/[artefactId]/sidecar/route.ts",
      "app/api/studio/proofs/route.ts",
    ]);
  });

  test("each route imports the shared rule or resolver — never its own copy", () => {
    for (const surface of surfaces) {
      const importsShared =
        surface.src.includes("@/lib/downloads/rule") ||
        surface.src.includes("@/lib/downloads/resolve") ||
        surface.src.includes("@/lib/downloads/centre");
      expect({ file: surface.rel, importsShared }).toEqual({ file: surface.rel, importsShared: true });
    }
  });

  test("the download routes serve through serveArtefact, which verifies the digest first", () => {
    for (const rel of ["app/api/studio/downloads/[artefactId]/route.ts", "app/api/studio/proofs/[artefactId]/route.ts"]) {
      const src = files.find((f) => f.rel === rel)!.src;
      expect({ rel, serve: src.includes("serveArtefact") }).toEqual({ rel, serve: true });
      expect({ rel, verify: src.includes("notFound") }).toEqual({ rel, verify: true });
    }
  });

  test("the Downloads page renders the derived centre and does not query artefacts itself", () => {
    const page = files.find((f) => f.rel === "app/(app)/downloads/page.tsx");
    expect(page).toBeDefined();
    expect(page!.src).toContain("loadDownloadCentre");
    expect(READS_ARTEFACTS.test(page!.src)).toBe(false);
  });
});

describe("the exclusion is written once", () => {
  test("no file under src/app writes its own syntheticProof: false filter", () => {
    // `syntheticProof: true` is allowed on a surface: the labelled proof read-out
    // REQUIRES the marking (the inverse rule), and the enqueue response reports
    // it. The FORBIDDING half — the exclusion a user's list needs — is what must
    // not be copied, because a copy is one edit away from disagreeing with rule.ts.
    const offenders = files
      .filter((f) => f.rel.startsWith("app/"))
      .filter((f) => /syntheticProof\s*:\s*false/.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test("rule.ts is where it lives, and it forbids both the artefact and the job", () => {
    const rule = files.find((f) => f.rel === "lib/downloads/rule.ts");
    expect(rule).toBeDefined();
    expect(rule!.src).toContain("syntheticProof: false");
    expect(rule!.src).toContain("SYNTHETIC_PROJECT_TITLE_PREFIX");
  });
});
