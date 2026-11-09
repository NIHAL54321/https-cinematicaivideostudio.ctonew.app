/**
 * The Dashboard's "Renders" card — both directions, and the source guard that
 * keeps it from drifting back to the wrong table.
 *
 * Phase 8 truthful-surfaces block, 2026-11-09. Before this block the Dashboard
 * read `Renders: 0` for an account whose delivered render the Export Center
 * listed in full, because it counted `RenderingJob` rows (the older export
 * queue, empty) and labelled them "Renders", while the pipeline writes
 * `RenderJob` rows.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rendersStat, type RenderCounts } from "../surface-counts";

const NO_ROWS: RenderCounts = { pipelineJobs: 0, legacyQueueJobs: 0, exportJobs: 0 };

describe("Dashboard 'Renders' card — the truthful sentence when the rows exist", () => {
  test("one delivered RenderJob reads as 1 render and the hint names the table", () => {
    const stat = rendersStat({ pipelineJobs: 1, legacyQueueJobs: 0, exportJobs: 0 });
    expect(stat.label).toBe("Renders");
    expect(stat.value).toBe(1);
    expect(stat.hint).toContain("1 RenderJob row");
    expect(stat.hint).toContain("Export Center");
    expect(stat.hint).not.toContain("No RenderJob rows");
  });

  test("several RenderJob rows are counted, pluralised, and still name the table", () => {
    const stat = rendersStat({ pipelineJobs: 3, legacyQueueJobs: 0, exportJobs: 0 });
    expect(stat.value).toBe(3);
    expect(stat.hint).toContain("3 RenderJob rows");
  });
});

describe("Dashboard 'Renders' card — the honest absence sentence when they do not", () => {
  test("zero rows reads 0 and names the table instead of a vague 'rendering jobs'", () => {
    const stat = rendersStat(NO_ROWS);
    expect(stat.value).toBe(0);
    expect(stat.hint).toContain("No RenderJob rows yet");
    expect(stat.hint).toContain("RenderJob table");
  });
});

describe("Dashboard 'Renders' card — two different things are never merged", () => {
  test("legacy RenderingJob rows are named separately and not added to the number", () => {
    const stat = rendersStat({ pipelineJobs: 2, legacyQueueJobs: 5, exportJobs: 4 });
    expect(stat.value).toBe(2);
    expect(stat.hint).toContain("5 RenderingJob rows");
    expect(stat.hint).toContain("counted separately");
    expect(stat.hint).not.toContain("7");
  });

  test("with 0 pipeline jobs but legacy rows present, the card still names the legacy rows", () => {
    const stat = rendersStat({ pipelineJobs: 0, legacyQueueJobs: 2, exportJobs: 0 });
    expect(stat.value).toBe(0);
    expect(stat.hint).toContain("No RenderJob rows yet");
    expect(stat.hint).toContain("2 RenderingJob rows");
  });
});

describe("source guard — the two surfaces cannot disagree again", () => {
  const root = join(import.meta.dir, "..", "..", "..");

  test("the Dashboard counts RenderJob through the shared module, never RenderingJob", () => {
    const page = readFileSync(join(root, "app", "(app)", "dashboard", "page.tsx"), "utf8");
    expect(page).toContain("readRenderCounts");
    expect(page).toContain("rendersStat");
    expect(page).not.toContain("prisma.renderingJob.count");
  });

  test("the Export Center uses the same module for its render count", () => {
    const page = readFileSync(join(root, "app", "(app)", "export-center", "page.tsx"), "utf8");
    expect(page).toContain("readRenderCounts");
    expect(page).not.toContain("prisma.renderingJob.count");
    expect(page).not.toContain("prisma.exportJob.count");
  });

  test("the shared module excludes synthetic encoder proofs, like listRenderJobs does", () => {
    const src = readFileSync(join(import.meta.dir, "..", "surface-counts.ts"), "utf8");
    expect(src).toContain("syntheticProof: false");
  });
});
