/**
 * The Export panel's readiness derivation and delivery gate (Phase 8, Export
 * panel block, 2026-11-14).
 *
 * What these tests hold:
 *   - the readiness sentence counts SceneAsset rows, and only rows: a scene with
 *     no asset is unsourced however good its prompt is;
 *   - when a scene is unsourced, the refusal printed beside the disabled button is
 *     the string `encode-master` throws — asserted against the shared function,
 *     and against the literal text, so a silent rewrite of either fails here;
 *   - an unreadable tree is NOT "ready";
 *   - nothing is called delivered before `checksum-artefact` says SUCCEEDED.
 */
import { describe, expect, test } from "bun:test";
import { exportReadiness, deliveryGate, DELIVERY_GATE_STAGE_ID } from "../export-view";
import { encodeRefusalSentence } from "@/lib/render/encode-refusal";
import type { ScriptTree, ScriptTreeSceneAsset } from "../pipeline";

function asset(id: string): ScriptTreeSceneAsset {
  return {
    id,
    name: `clip ${id}`,
    kind: "VIDEO",
    provider: "pixabay",
    externalId: `ext-${id}`,
    storedBytes: true,
    sizeBytes: 1024,
  } as ScriptTreeSceneAsset;
}

function tree(sceneAssets: Array<ScriptTreeSceneAsset[]>): ScriptTree {
  return {
    script: {
      id: "script-1",
      title: "A project",
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter one",
          order: 1,
          scenes: sceneAssets.map((assets, i) => ({
            id: `scene-${i + 1}`,
            title: `Scene ${i + 1}`,
            order: i + 1,
            narration: "Narration.",
            durationSeconds: 20,
            visualPrompt: "a visual prompt",
            assets,
          })),
        },
      ],
    },
    meta: {},
  } as unknown as ScriptTree;
}

describe("exportReadiness — what the Export tab states before the button", () => {
  test("every scene sourced: the button may be pressed and no refusal is printed", () => {
    const view = exportReadiness(tree([[asset("a")], [asset("b")], [asset("c")]]));
    expect(view.kind).toBe("scenes");
    expect(view.total).toBe(3);
    expect(view.sourced).toBe(3);
    expect(view.unsourced).toBe(0);
    expect(view.refusal).toBeNull();
    expect(view.canQueue).toBe(true);
    expect(view.blockedReason).toBeNull();
    expect(view.summary).toContain("All 3 scenes have a sourced clip");
  });

  test("one scene unsourced: the button is disabled and the encode stage's exact refusal is shown", () => {
    const view = exportReadiness(tree([[asset("a")], [], [asset("c")]]));
    expect(view.total).toBe(3);
    expect(view.sourced).toBe(2);
    expect(view.unsourced).toBe(1);
    expect(view.canQueue).toBe(false);
    expect(view.blockedReason).not.toBeNull();
    expect(view.unsourcedScenes).toEqual([{ id: "scene-2", order: 2 }]);
    // The same function the stage throws with…
    expect(view.refusal).toBe(
      encodeRefusalSentence({ sceneCount: 3, missing: [{ id: "scene-2", order: 2 }] }),
    );
    // …and the literal sentence, so a rewrite of either side fails loudly.
    expect(view.refusal).toContain("encode-master REFUSES to encode this project: 1 of 3 scene(s) carry no source media");
    expect(view.refusal).toContain("scene(s) #2 (scene-2)");
    expect(view.refusal).toContain("A master built from 2 of 3 scenes would be delivered as the project's video while missing the rest of it");
  });

  test("no scenes at all: disabled, with the reason naming the probe that blocks it", () => {
    const view = exportReadiness(tree([]));
    expect(view.kind).toBe("empty");
    expect(view.total).toBe(0);
    expect(view.canQueue).toBe(false);
    expect(view.refusal).toBeNull();
    expect(view.blockedReason).toContain("project-has-scenes");
  });

  test("an unreadable tree is not ready — nothing is claimed either way", () => {
    const view = exportReadiness(null);
    expect(view.canQueue).toBe(false);
    expect(view.refusal).toBeNull();
    expect(view.summary).toContain("could not be read");
    expect(view.blockedReason).toContain("could not be read");
  });
});

describe("deliveryGate — nothing is delivered before the checksum row says so", () => {
  test("checksum-artefact SUCCEEDED allows the delivery", () => {
    const gate = deliveryGate({
      stages: [
        { id: "plan-delivery", state: "SUCCEEDED" },
        { id: "container-mux", state: "SUCCEEDED" },
        { id: DELIVERY_GATE_STAGE_ID, state: "SUCCEEDED" },
      ],
    });
    expect(gate.allowed).toBe(true);
    expect(gate.state).toBe("SUCCEEDED");
    expect(gate.reason).toBe("");
  });

  test("a rendered but unverified file is not a delivery", () => {
    const gate = deliveryGate({
      stages: [
        { id: "container-mux", state: "SUCCEEDED" },
        { id: DELIVERY_GATE_STAGE_ID, state: "RUNNING" },
      ],
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("RUNNING");
    expect(gate.reason).toContain("not a delivery");
  });

  test("a stage the pipeline never reached allows nothing", () => {
    const gate = deliveryGate({ stages: [{ id: "container-mux", state: "SUCCEEDED" }] });
    expect(gate.allowed).toBe(false);
    expect(gate.state).toBeNull();
    expect(gate.reason).toContain("never reached");
  });
});
