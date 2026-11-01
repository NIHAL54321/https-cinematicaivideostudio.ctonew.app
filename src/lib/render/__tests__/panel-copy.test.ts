/**
 * GUARD 4 — THE PIPELINE PANEL'S COPY CARRIES NO PROMISE THE CODE DOES NOT KEEP
 * (Phase 8, block 6).
 *
 * WHY A SCANNER AND NOT A SENTENCE-BY-SENTENCE REVIEW. Copy drifts. Someone adds
 * a comforting line ("your render is resumable", "a failed stage is retried
 * automatically"), the code keeps its old behaviour, and the product now says
 * something it does not do. A review catches that once; a scanner catches it
 * every run.
 *
 * WHAT IS FORBIDDEN, AND WHY EACH ONE IS A LIE ON THIS BUILD:
 *
 *   "resumable"            — a retry is a NEW attempt that starts at the first
 *                            stage that did not succeed. Nothing resumes a
 *                            process, and a stage that had already started is
 *                            re-run, not continued.
 *   "automatically retried" / "auto-retry" / "will recover" / "recovers
 *   automatically"         — nothing retries by itself. A person presses Retry,
 *                            and the retry needs the queue to be connected.
 *   "guaranteed" / "always succeeds" / "never fails" / "100%" — no run is
 *                            promised to end well; the pipeline reports what it
 *                            observed.
 *   "no data loss" / "never lose" / "picks up where it left off" — a killed
 *                            process leaves a stage with no outcome, and its
 *                            partial work is not continued.
 *   "seamless" / "instantly" / "self-healing" / "bulletproof" / "uninterrupted"
 *                          — adjectives that assert outcomes nobody measured.
 *
 * COMMENTS ARE STRIPPED BEFORE THE SCAN, on purpose: a comment that explains why
 * a word is forbidden must not itself trip the guard. Only what a reader can see
 * (JSX text and string literals) is scanned.
 *
 * THE NEGATIVE CONTROL at the bottom runs the same scanner over a deliberately
 * broken paragraph and requires the hits, in order — so a scanner that quietly
 * stopped matching fails this file instead of passing it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RENDER_COMPONENTS = join(import.meta.dir, "../../../components/render");

interface Forbidden {
  phrase: string;
  re: RegExp;
  why: string;
}

const FORBIDDEN: Forbidden[] = [
  {
    phrase: "resumable",
    re: /\bresumable\b/i,
    why: "a retry is a new attempt that starts at the first stage that did not succeed; no process is resumed",
  },
  {
    phrase: "automatically retried",
    re: /\bautomatically\s+retried\b/i,
    why: "nothing retries by itself — a person presses Retry",
  },
  { phrase: "auto-retry", re: /\bauto[-\s]?retr(y|ies|ied)\b/i, why: "there is no automatic retry on this build" },
  { phrase: "will recover", re: /\bwill\s+recover\b/i, why: "a job left by a dead process does not recover itself" },
  {
    phrase: "recovers automatically",
    re: /\brecovers?\s+automatically\b/i,
    why: "recovery is a person pressing Retry, not a behaviour of the pipeline",
  },
  { phrase: "guaranteed", re: /\bguarantee(d|s)?\b/i, why: "no outcome of a render is guaranteed" },
  { phrase: "always succeeds", re: /\balways\s+succeeds?\b/i, why: "stages really do fail, and the panel shows it" },
  { phrase: "never fails", re: /\bnever\s+fails?\b/i, why: "stages really do fail, and the panel shows it" },
  { phrase: "100%", re: /\b100\s?%\s*(reliable|success|succeeds|guaranteed)\b/i, why: "an unmeasured success rate" },
  { phrase: "no data loss", re: /\bno\s+data\s+loss\b/i, why: "a killed process loses the stage it was in" },
  { phrase: "never lose", re: /\bnever\s+lose\b/i, why: "the work in flight when a process dies is not kept" },
  {
    phrase: "picks up where it left off",
    re: /\bpicks?\s+up\s+where\s+it\s+left\s+off\b/i,
    why: "the interrupted stage is re-run from its start, not continued",
  },
  { phrase: "self-healing", re: /\bself[-\s]?healing\b/i, why: "nothing heals itself" },
  { phrase: "seamless", re: /\bseamless(ly)?\b/i, why: "an adjective that asserts an outcome nobody measured" },
  { phrase: "instantly", re: /\binstantly\b/i, why: "a render is not instant, and this page never says so" },
  { phrase: "bulletproof", re: /\bbulletproof\b/i, why: "an adjective that asserts an outcome nobody measured" },
  { phrase: "uninterrupted", re: /\buninterrupted\b/i, why: "attempts are interrupted on this machine" },
];

/** Remove comments so that explaining a forbidden word is not itself a hit. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every forbidden phrase the copy really contains, in declaration order. */
function scanCopy(src: string): Array<{ phrase: string; matched: string; why: string }> {
  const text = stripComments(src);
  const hits: Array<{ phrase: string; matched: string; why: string }> = [];
  for (const f of FORBIDDEN) {
    const m = text.match(f.re);
    if (m) hits.push({ phrase: f.phrase, matched: m[0], why: f.why });
  }
  return hits;
}

const PANEL_PATH = join(RENDER_COMPONENTS, "render-pipeline-panel.tsx");
const panel = readFileSync(PANEL_PATH, "utf8");

/* ------------------------------------------------------------------ */
/* 1 — the panel's own copy                                            */
/* ------------------------------------------------------------------ */

describe("the pipeline panel promises nothing it cannot keep", () => {
  test("no forbidden promise appears in the panel's rendered copy", () => {
    const hits = scanCopy(panel);
    expect(hits).toEqual([]);
  });

  test("no forbidden promise appears in any render component", () => {
    const files = readdirSync(RENDER_COMPONENTS).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: Array<{ file: string; phrase: string; matched: string }> = [];
    for (const file of files) {
      for (const hit of scanCopy(readFileSync(join(RENDER_COMPONENTS, file), "utf8"))) {
        offenders.push({ file, phrase: hit.phrase, matched: hit.matched });
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2 — what the panel DOES say                                         */
/* ------------------------------------------------------------------ */

describe("the panel states plainly what a retry does and does not do", () => {
  test("it carries the four pieces of copy the block requires", () => {
    // 1. a retry control that posts {action:"retry"}
    expect(panel).toContain('action: "retry"');
    // 2. a tone and label for an interrupted stage
    expect(panel).toContain("INTERRUPTED: \"danger\"");
    expect(panel).toContain("interrupted:");
    expect(panel).toContain("interrupted — the process that owned this stage stopped without recording an outcome");
    // 3. an attempt history
    expect(panel).toContain("job.attempts.map");
    expect(panel).toContain("files reused:");
    expect(panel).toContain("ran:");
    // 4. copy that says what it does NOT do, in the panel's own words
    expect(panel).toContain("What Retry does, and what it does not do");
    expect(panel).toContain("Nothing is retried unless this button is pressed");
    expect(panel).toContain("edit or delete any");
    expect(panel).toContain("needs the queue to be connected");
  });

  test("a refusal is quoted from the response, with its status code", () => {
    // The panel must show the server's own sentence, not a friendlier one.
    expect(panel).toContain("body?.error");
    expect(panel).toContain("${res.status} —");
    expect(panel).toContain("The server refused this retry");
  });

  test("the interrupted sentence comes from the server, never from a literal on the page", () => {
    // The verdict's own words (observed vs lease-based) are rendered from
    // `s.stateBasis` / `a.liveness.basis`, so the page cannot pick one.
    expect(panel).toContain("s.stateBasis");
    expect(panel).toContain("a.liveness.basis");
    // ...and the page never asserts the lease on its own behalf.
    expect(panel).not.toContain("TIME-BASED INFERENCE");
  });
});

/* ------------------------------------------------------------------ */
/* 3 — THE NEGATIVE CONTROLS                                           */
/* ------------------------------------------------------------------ */

describe("NEGATIVE CONTROLS: the scanner really fires", () => {
  test("a paragraph full of promises is caught, phrase by phrase, in order", () => {
    const broken = [
      "Your render is resumable.",
      "A failed stage will be automatically retried, and the job will recover on its own.",
      "Delivery is guaranteed, and there is no data loss.",
      "The pipeline is seamless, self-healing and bulletproof, and it finishes instantly.",
    ].join(" ");
    const hits = scanCopy(broken).map((h) => h.phrase);
    expect(hits).toEqual([
      "resumable",
      "automatically retried",
      "will recover",
      "guaranteed",
      "no data loss",
      "self-healing",
      "seamless",
      "instantly",
      "bulletproof",
    ]);
  });

  test("a single broken word in otherwise honest copy is still caught", () => {
    expect(scanCopy("The retry is auto-retried when the process dies.").map((h) => h.phrase)).toEqual(["auto-retry"]);
    expect(scanCopy("This run is 100% reliable.").map((h) => h.phrase)).toEqual(["100%"]);
    expect(scanCopy("The job picks up where it left off.").map((h) => h.phrase)).toEqual(["picks up where it left off"]);
    expect(scanCopy("Progress is uninterrupted.").map((h) => h.phrase)).toEqual(["uninterrupted"]);
  });

  test("a COMMENT explaining the rule is not a hit — only what a reader can see is scanned", () => {
    const withComment = [
      "/* This copy must never say the render is resumable or that it is automatically retried. */",
      "// never claim the job will recover, and never say guaranteed",
      "export const copy = 'A retry starts at the first stage that did not succeed.';",
    ].join("\n");
    expect(scanCopy(withComment)).toEqual([]);
  });

  test("JSX text and string literals ARE scanned — the exemption is comments, not code", () => {
    const jsx = '<p className="x">Your render is resumable</p>';
    expect(scanCopy(jsx).map((h) => h.phrase)).toEqual(["resumable"]);
    const literal = 'const note = "a guaranteed delivery";';
    expect(scanCopy(literal).map((h) => h.phrase)).toEqual(["guaranteed"]);
  });
});
