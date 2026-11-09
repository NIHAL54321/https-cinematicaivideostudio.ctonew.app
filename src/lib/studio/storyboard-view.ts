/**
 * The Storyboard / Script tab's view of a project's structure plan, as a PURE
 * derivation. Phase 8 truthful-surfaces block, 2026-11-09.
 *
 * ── What went wrong ────────────────────────────────────────────────────────
 * `storyboard-tab.tsx` rendered "No structure plan yet" for a project that
 * plainly had one — the page header above it read "3 chapters · 6 scenes". Two
 * separate faults, both fixed here:
 *
 *  1. The tab fetched `GET /api/projects/<id>/storyboard`, whose body is
 *     `{ tree }`, but treated the body AS the tree (`tree.script`,
 *     `tree.meta`), so `tree.script` was always `undefined` and the empty state
 *     always fired. The route now returns the tree unwrapped, like its sibling
 *     `/script`, and `readScriptTreeBody()` below accepts either shape so a
 *     stale cached body can never produce a false "nothing here".
 *  2. The empty state had ONE sentence for four different situations. It now
 *     says exactly what is missing, naming the table that is empty:
 *       - no `Script` row at all      → "No structure plan yet" + names Script;
 *       - a `Script` row, no chapters → says so, and how many scenes exist;
 *       - chapters but no scenes      → says so;
 *       - scenes exist                → they are shown. If none of them carries
 *         narration, the tab says the script step is blocked for lack of a
 *         provider (when that is the true reason) or not yet run (when a
 *         provider IS connected) — never "no structure plan".
 *
 * Pure on purpose: both directions are unit-tested without a database.
 */
import type { ScriptTree, ScriptTreeChapter, ScriptTreeScene } from "./pipeline";

/** The subset of /api/ai/status this module needs (null = not read / unknown). */
export type ScriptCapabilityState = { status: string; requiredEnv?: string[] } | null;

export interface MissingScript {
  kind: "blocked" | "not-generated";
  sentence: string;
}

export type StoryboardView =
  | {
      kind: "empty";
      /** Headline — "No structure plan yet" only when nothing is persisted. */
      title: string;
      body: string;
      /** What is missing, named concretely (table + row counts). */
      detail: string;
    }
  | {
      kind: "scenes";
      chapters: ScriptTreeChapter[];
      scenes: ScriptTreeScene[];
      totalSeconds: number;
      /** Present only when scenes exist but none carries narration text. */
      missingScript: MissingScript | null;
    };

/**
 * Accept either `{ tree }` (what the storyboard route used to return) or the
 * tree itself (what /script returns and what the tab parses). Anything else is
 * `null` — never a thrown error that would be reported as "could not load".
 */
export function readScriptTreeBody(body: unknown): ScriptTree | null {
  if (!body || typeof body !== "object") return null;
  const asRecord = body as Record<string, unknown>;
  if (asRecord.tree && typeof asRecord.tree === "object") {
    const inner = asRecord.tree as Record<string, unknown>;
    if ("script" in inner || "meta" in inner) return asRecord.tree as ScriptTree;
  }
  if ("script" in asRecord || "meta" in asRecord) return body as ScriptTree;
  return null;
}

function narrationCount(scenes: ScriptTreeScene[]): number {
  return scenes.filter((s) => typeof s.narration === "string" && s.narration.trim().length > 0).length;
}

function scriptBlockedSentence(sceneCount: number, capability: ScriptCapabilityState): MissingScript {
  const envs = capability?.requiredEnv ?? [];
  const envPhrase = envs.length ? ` (set one of ${envs.join(", ")} server-side)` : "";
  const scenePhrase = `${sceneCount} scene${sceneCount === 1 ? "" : "s"} exist`;
  if (capability && capability.status === "connected") {
    return {
      kind: "not-generated",
      sentence:
        `No scene carries narration text yet: the script step has not been run on this project. ` +
        `${scenePhrase} from the structure plan, and a script-generation provider is connected, so ` +
        `Generate Script can fill them in.`,
    };
  }
  return {
    kind: "blocked",
    sentence:
      `The script step is blocked: no provider for script_generation is configured on this server${envPhrase}. ` +
      `${scenePhrase} from the structure plan, but none carries narration text, and nothing here ` +
      `invents any.`,
  };
}

export function storyboardView(tree: ScriptTree | null, capability: ScriptCapabilityState): StoryboardView {
  const chapters = tree?.script?.chapters ?? [];
  const scenes = chapters.flatMap((c) => c.scenes);
  const totalSeconds = scenes.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);

  /* ---- Scenes exist: show them, and name any missing script text --------- */
  if (scenes.length > 0) {
    const withNarration = narrationCount(scenes);
    return {
      kind: "scenes",
      chapters,
      scenes,
      totalSeconds,
      missingScript: withNarration > 0 ? null : scriptBlockedSentence(scenes.length, capability),
    };
  }

  /* ---- A Script row exists but holds no chapters ------------------------- */
  if (tree?.script) {
    return {
      kind: "empty",
      title: "A script record, but no chapters yet",
      body:
        `This project has a row in the Script table${tree.script.title ? ` ("${tree.script.title}")` : ""}, ` +
        `but no Chapter rows and therefore no Scene rows. Nothing is invented to fill the storyboard.`,
      detail: "Missing: Chapter rows (and the Scene rows under them).",
    };
  }

  /* ---- Chapters exist but no scenes -------------------------------------- */
  if (chapters.length > 0) {
    return {
      kind: "empty",
      title: "Chapters, but no scenes yet",
      body: `This project has ${chapters.length} chapter${chapters.length === 1 ? "" : "s"} and 0 scenes. Nothing is invented to fill the storyboard.`,
      detail: "Missing: Scene rows under the existing chapters.",
    };
  }

  /* ---- Nothing persisted at all ------------------------------------------ */
  return {
    kind: "empty",
    title: "No structure plan yet",
    body:
      "No Script row exists for this project, so no Chapter or Scene rows have been persisted either. " +
      "Start from Create Video to build the idea → script → story → storyboard structure.",
    detail: "Missing: a Script row, its Chapter rows, and their Scene rows.",
  };
}
