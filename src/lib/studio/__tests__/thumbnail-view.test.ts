/**
 * The Thumbnail tab's payload, driven with rows only. What these tests pin: the
 * brief is derived from the project's own rows (never invented), the frame comes
 * from the stored aspect column, and the panel always says no image exists and
 * names the env vars the provider registry derives.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveFrame,
  deriveKeyText,
  deriveThumbnailView,
  type ThumbnailBriefInput,
  type ThumbnailProviderFacts,
} from "../thumbnail-view";
import type { SceneSource } from "@/lib/subtitles/from-scenes";

function scene(id: string, number: number, over: Partial<SceneSource> = {}): SceneSource {
  return { id, number, title: `Scene ${number}`, narration: null, durationSeconds: 30, ...over };
}

function provider(over: Partial<ThumbnailProviderFacts> = {}): ThumbnailProviderFacts {
  return {
    capability: "thumbnail_generation",
    connected: false,
    status: "not_connected",
    requiredEnv: ["OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "REPLICATE_API_TOKEN", "STABILITY_API_KEY"],
    envNote: "Derived note.",
    providers: [
      { id: "openai", name: "OpenAI", configured: false, wired: false },
      { id: "replicate", name: "Replicate", configured: false, wired: false },
    ],
    ...over,
  };
}

function input(over: Partial<ThumbnailBriefInput> = {}): ThumbnailBriefInput {
  return {
    projectId: "proj_1",
    projectTitle: "The Deep-Sea Cable",
    targetAspectRatio: "SIXTEEN_NINE",
    script: { logline: "A documentary about the cables that carry the internet.", title: "Cable" },
    scenes: [scene("s1", 1, { narration: "Two thousand metres down, a cable hums." })],
    thumbnailRows: 0,
    thumbnailAssets: 0,
    provider: provider(),
    ...over,
  };
}

describe("the key text", () => {
  test("comes from the Script logline when the script has one, and names that field", () => {
    const { keyText, missing } = deriveKeyText({
      script: { logline: "A documentary about the cables that carry the internet." },
      scenes: [scene("s1", 1, { narration: "Something else entirely." })],
    });
    expect(missing).toBeNull();
    expect(keyText!.value).toBe("A documentary about the cables that carry the internet.");
    expect(keyText!.source).toBe("Script.logline");
  });

  test("falls back to the first narrated scene, then to a scene title", () => {
    const narrated = deriveKeyText({
      script: { logline: null },
      scenes: [scene("s1", 1), scene("s2", 2, { narration: "The first narrated line. A second one." })],
    });
    expect(narrated.keyText!.value).toBe("The first narrated line.");
    expect(narrated.keyText!.source).toBe("Scene.narration (scene 2)");

    const titled = deriveKeyText({
      script: null,
      scenes: [scene("s1", 1, { title: "Opening shot" })],
    });
    expect(titled.keyText!.value).toBe("Opening shot");
    expect(titled.keyText!.source).toBe("Scene.title (scene 1)");
  });

  test("with no script text at all it carries nothing and says why", () => {
    const { keyText, missing } = deriveKeyText({ script: null, scenes: [scene("s1", 1, { title: null })] });
    expect(keyText).toBeNull();
    expect(missing).toContain("no key text");
    expect(missing).toContain("none is invented");
  });
});

describe("the target frame", () => {
  test("is read from the stored aspect column, and states when there is none", () => {
    expect(deriveFrame("SIXTEEN_NINE").value).toBe("16:9 — 1280 × 720");
    expect(deriveFrame("NINE_SIXTEEN").value).toBe("9:16 — 720 × 1280");
    expect(deriveFrame(null).value).toBe("no target frame");
    expect(deriveFrame(null).source).toContain("empty");
    expect(deriveFrame("SQUARE").source).toContain("does not map");
  });
});

describe("the panel's two statements", () => {
  test("the brief sentence names the rows it was read from", () => {
    const view = deriveThumbnailView(input());
    expect(view.brief.title.value).toBe("The Deep-Sea Cable");
    expect(view.brief.title.source).toBe("Project.title");
    expect(view.brief.sentence).toContain("Script.logline");
    expect(view.brief.sentence).toContain("it is not a picture");
  });

  test("no image exists, the capability is named, and the env var names come from the payload", () => {
    const view = deriveThumbnailView(input());
    expect(view.image.exists).toBe(false);
    expect(view.image.sentence).toContain("No thumbnail image exists");
    expect(view.image.sentence).toContain("0 Thumbnail rows");
    expect(view.image.sentence).toContain("0 Asset rows");
    expect(view.image.sentence).toContain("thumbnail_generation");
    expect(view.image.sentence).toContain("not connected on this deployment");
    expect(view.image.sentence).toContain("one of OPENAI_API_KEY, GOOGLE_AI_API_KEY, REPLICATE_API_TOKEN or STABILITY_API_KEY");
    expect(view.image.sentence).toContain("No placeholder image is shown");
  });

  test("a project with no rows produces no invented copy", () => {
    const view = deriveThumbnailView(
      input({ script: null, scenes: [], targetAspectRatio: null, projectTitle: "Untitled project" }),
    );
    expect(view.brief.keyText).toBeNull();
    expect(view.brief.keyTextMissingReason).toContain("no key text");
    expect(view.brief.frame.value).toBe("no target frame");
    expect(view.brief.sceneCount).toBe(0);
    expect(view.image.exists).toBe(false);
  });
});
