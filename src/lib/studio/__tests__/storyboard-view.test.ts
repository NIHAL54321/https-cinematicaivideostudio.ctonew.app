/**
 * The Storyboard / Script tab's structure view — both directions.
 *
 * Phase 8 truthful-surfaces block, 2026-11-09. The Storyboard tab rendered
 * "No structure plan yet" for a project whose own header read
 * "3 chapters · 6 scenes", because the route answered `{ tree }` while the tab
 * parsed the body as the tree (`tree.script` → undefined).
 */
import { describe, expect, test } from "bun:test";
import type { ScriptTree } from "../pipeline";
import { readScriptTreeBody, storyboardView } from "../storyboard-view";

const NOT_CONNECTED = { status: "not_connected", requiredEnv: ["OPENAI_API_KEY"] };
const CONNECTED = { status: "connected", requiredEnv: [] };

function scene(order: number, narration: string | null) {
  return {
    id: `sc${order}`,
    order,
    title: `Scene ${order}`,
    durationSeconds: 20,
    narration,
    visualPrompt: `visual ${order}`,
    status: "DRAFT",
    mediaType: "video",
    camera: "static",
    clips: null,
    assets: [],
  };
}

const TREE: ScriptTree = {
  script: {
    id: "script1",
    title: "The Future of Artificial Intelligence",
    language: "en",
    style: "cinematic",
    chapters: [
      { id: "ch1", order: 1, title: "Hook", summary: null, scenes: [scene(1, "text one"), scene(2, "text two")] },
      { id: "ch2", order: 2, title: "Timeline", summary: null, scenes: [scene(1, "text three"), scene(2, "text four")] },
      { id: "ch3", order: 3, title: "Implication", summary: null, scenes: [scene(1, "text five"), scene(2, "text six")] },
    ],
  },
  meta: null,
};

const SILENT_TREE: ScriptTree = {
  script: {
    id: "script2",
    title: "Silent",
    language: "en",
    style: "cinematic",
    chapters: [
      { id: "ch1", order: 1, title: "Hook", summary: null, scenes: [scene(1, null), scene(2, "  ")] },
    ],
  },
  meta: null,
};

describe("structure exists → the scenes are shown, never 'no structure plan yet'", () => {
  test("six scenes across three chapters are all present, with their real durations", () => {
    const view = storyboardView(TREE, NOT_CONNECTED);
    expect(view.kind).toBe("scenes");
    if (view.kind !== "scenes") throw new Error("unreachable");
    expect(view.chapters).toHaveLength(3);
    expect(view.scenes).toHaveLength(6);
    expect(view.totalSeconds).toBe(120);
    expect(view.missingScript).toBeNull();
  });
});

describe("scenes exist but carry no narration → the precise missing-script sentence", () => {
  test("no provider connected: says the script step is blocked, and names the capability + env", () => {
    const view = storyboardView(SILENT_TREE, NOT_CONNECTED);
    expect(view.kind).toBe("scenes");
    if (view.kind !== "scenes") throw new Error("unreachable");
    expect(view.missingScript?.kind).toBe("blocked");
    expect(view.missingScript?.sentence).toContain("The script step is blocked");
    expect(view.missingScript?.sentence).toContain("script_generation");
    expect(view.missingScript?.sentence).toContain("configured on this server");
    expect(view.missingScript?.sentence).toContain("OPENAI_API_KEY");
    expect(view.missingScript?.sentence).not.toContain("no structure plan");
  });

  test("provider connected: says it has not been run, and never blames a missing provider", () => {
    const view = storyboardView(SILENT_TREE, CONNECTED);
    if (view.kind !== "scenes") throw new Error("expected scenes");
    expect(view.missingScript?.kind).toBe("not-generated");
    expect(view.missingScript?.sentence).toContain("has not been run");
    expect(view.missingScript?.sentence).not.toContain("blocked");
  });
});

describe("nothing persisted → the honest absence sentence, naming the table", () => {
  test("no Script row at all keeps 'No structure plan yet' and names the Script table", () => {
    const view = storyboardView({ script: null, meta: null }, NOT_CONNECTED);
    expect(view.kind).toBe("empty");
    if (view.kind !== "empty") throw new Error("unreachable");
    expect(view.title).toBe("No structure plan yet");
    expect(view.body).toContain("No Script row exists");
    expect(view.detail).toContain("Script row");
  });

  test("a Script row with no chapters is described as exactly that", () => {
    const view = storyboardView(
      { script: { id: "s", title: "T", language: "en", style: null, chapters: [] }, meta: null },
      NOT_CONNECTED,
    );
    if (view.kind !== "empty") throw new Error("expected empty");
    expect(view.title).toContain("no chapters");
    expect(view.detail).toContain("Chapter rows");
  });

  test("a null tree is the same honest absence, not a crash", () => {
    const view = storyboardView(null, null);
    expect(view.kind).toBe("empty");
    if (view.kind !== "empty") throw new Error("unreachable");
    expect(view.title).toBe("No structure plan yet");
  });
});

describe("the response body is read in either shape", () => {
  test("the unwrapped tree (what /script returns) is read as the tree", () => {
    expect(readScriptTreeBody(TREE)).toBe(TREE);
  });

  test("the old `{ tree }` wrapper is still read — a cached body cannot fake an empty project", () => {
    expect(readScriptTreeBody({ tree: TREE })).toBe(TREE);
  });

  test("anything else is null, never a false empty state", () => {
    expect(readScriptTreeBody(null)).toBeNull();
    expect(readScriptTreeBody({ error: "nope" })).toBeNull();
  });
});
