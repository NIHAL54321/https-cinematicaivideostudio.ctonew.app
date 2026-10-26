/**
 * SYNTHETIC PROJECTS ARE KEPT OUT OF THE USER'S OWN LISTS (Phase 8, block 2b,
 * part 6).
 *
 * A synthetic encoder proof creates a Project so its job, scenes and artefacts
 * have somewhere to hang. That project sits in the same table as the user's own
 * work, so any selector that lists projects would offer it — and a visitor could
 * pick "SYNTHETIC ENCODER PROOF — 3840×2160 youtube-2160p" and read its render
 * as if it were theirs.
 *
 * Synthetic JOBS are excluded already (`listRenderJobs` filters
 * `syntheticProof: false`). This file proves the same rule for PROJECTS:
 *
 *   1. The pure filter drops a project named by the job's own marking.
 *   2. It drops a project whose title carries the synthetic marker even when no
 *      id was supplied — the marker alone is enough.
 *   3. It keeps a normal project, and keeps the order of the list it returns.
 *   4. Every surface that lists projects for a user calls the exclusion:
 *      the Export Center page and `listProjects`. A page that lists projects
 *      without filtering fails this test.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SYNTHETIC_PROJECT_TITLE_PREFIX,
  excludeSyntheticProjects,
  isSyntheticProject,
} from "@/lib/render/synthetic-projects";
import { SYNTHETIC_MARKER } from "@/lib/render/synthetic-source";

const ROOT = join(process.cwd(), "src");
const exportCenter = readFileSync(join(ROOT, "app/(app)/export-center/page.tsx"), "utf8");
const projectsLib = readFileSync(join(ROOT, "lib/projects.ts"), "utf8");

const SYNTHETIC = { id: "prj_synthetic", title: "SYNTHETIC ENCODER PROOF — 3840×2160 youtube-2160p" };
const MINE = { id: "prj_mine", title: "The Future of Artificial Intelligence" };

describe("the filter itself", () => {
  test("the title this app gives a synthetic project starts with the marker it filters on", () => {
    // The title is built in the render service as `SYNTHETIC ENCODER PROOF — …`;
    // the filter must recognise exactly that shape.
    expect(SYNTHETIC_PROJECT_TITLE_PREFIX).toBe("SYNTHETIC ENCODER PROOF");
    expect(isSyntheticProject(SYNTHETIC)).toBe(true);
    expect(isSyntheticProject(MINE)).toBe(false);
    // And the path marker the artefacts carry is a different string — asserted
    // here so the two cannot be confused silently.
    expect(SYNTHETIC_MARKER).toBe("synthetic-encoder-proof");
  });

  test("a project whose id was marked synthetic on its job is dropped, whatever its title", () => {
    const renamed = { id: "prj_synthetic", title: "A title nobody would recognise" };
    expect(isSyntheticProject(renamed, ["prj_synthetic"])).toBe(true);
    expect(excludeSyntheticProjects([SYNTHETIC, MINE], ["prj_synthetic"])).toEqual([MINE]);
  });

  test("a project with a normal title but a marked id is still dropped — the marking wins", () => {
    const sneaky = { id: "prj_marked", title: "My holiday video" };
    expect(excludeSyntheticProjects([sneaky, MINE], new Set(["prj_marked"]))).toEqual([MINE]);
  });

  test("the user's own projects survive, in order, and the input is not mutated", () => {
    const second = { id: "prj_second", title: "Second project" };
    const input = [MINE, SYNTHETIC, second];
    const out = excludeSyntheticProjects(input, []);
    expect(out).toEqual([MINE, second]);
    expect(input.length).toBe(3);
  });
});

describe("every surface that lists projects for a user applies the exclusion", () => {
  test("the Export Center page filters the project list it feeds to its selectors", () => {
    expect(exportCenter).toContain("syntheticProjectIds");
    expect(exportCenter).toContain("excludeSyntheticProjects");
    // The query itself must exclude the marked ids, so the list is never even
    // built with them in it.
    expect(exportCenter).toContain("id: { notIn: syntheticIds }");
  });

  test("listProjects filters, so the projects page and every picker built on it do too", () => {
    expect(projectsLib).toContain("await syntheticProjectIds(userId)");
    expect(projectsLib).toContain("excludeSyntheticProjects(projects");
  });
});
