/**
 * The SIBLING sweep this block exists for.
 *
 * Block 15 fixed the shared result panel — and the same defect (a reached and
 * rejected provider attempt described as "Provider Not Connected", or with a
 * "no provider slot is registered for this capability" line) was still living
 * in five sibling surfaces that classify their own payload:
 *
 *   src/components/studio/generator.tsx                      (image / video generator)
 *   src/app/(app)/ai/music-studio/music-studio-client.tsx
 *   src/app/(app)/ai/sound-effects/sound-effects-client.tsx
 *   src/app/(app)/ai/voice-studio/voice-studio-client.tsx
 *   src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx
 *
 * Each route answered `connected:false` for BOTH the unkeyed state and a failed
 * attempt, and each client hard-rendered the "not connected" panel for it. The
 * fix routes every non-connected payload through `studioStepView()` +
 * `<AiResultViewPanel>` — one implementation — and makes each route forward the
 * orchestrator's own `status` and `attempts`.
 *
 * This file pins the WIRING, by reading the sources: the defect class survives in
 * sibling files, so a regression here is a source-level one and the test has to
 * look at the sources. The classification itself is pinned by the unit tests in
 * `src/lib/ai/__tests__/result-view.test.ts` and the rendered-markup tests in
 * `src/components/projects/__tests__/ai-result-panel.test.tsx`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Every surface that renders a studio step result. */
const SURFACES = [
  "src/components/studio/generator.tsx",
  "src/app/(app)/ai/music-studio/music-studio-client.tsx",
  "src/app/(app)/ai/sound-effects/sound-effects-client.tsx",
  "src/app/(app)/ai/voice-studio/voice-studio-client.tsx",
  "src/app/(app)/ai/subtitle-studio/subtitle-studio-client.tsx",
];

/** Every route those surfaces post to, and the capability each one answers for. */
const ROUTES: [string, string][] = [
  ["src/app/api/studio/generate/route.ts", "image_generation / video_generation"],
  ["src/app/api/studio/music/route.ts", "music_generation"],
  ["src/app/api/studio/sfx/route.ts", "sound_effects"],
  ["src/app/api/studio/voice/route.ts", "voice_generation"],
  ["src/app/api/studio/subtitles/route.ts", "subtitle_generation"],
];

describe("every studio surface classifies a non-connected step through the shared model", () => {
  for (const file of SURFACES) {
    test(`${file} uses studioStepView + AiResultViewPanel`, () => {
      const s = src(file);
      expect(s).toContain("studioStepView");
      expect(s).toContain("AiResultViewPanel");
      // The old shape: its own panel, decided by `connected` alone.
      expect(s).not.toContain("ProviderNotConnected");
      // Its own hard-coded heading is what must be gone (honest copy that
      // merely names the state may remain).
      expect(s).not.toContain(">Provider Not Connected<");
    });

    test(`${file} carries the orchestrator's attempts/status through to the classifier`, () => {
      const s = src(file);
      // The payload type must admit both, or the route's own answer cannot reach
      // the classifier and the failure would be re-described as "not connected".
      expect(s).toContain("status?: string");
      expect(s).toContain("attempts?: AiAttempt[]");
    });
  }
});

describe("every studio route forwards the orchestrator's own status and attempts", () => {
  for (const [file, capability] of ROUTES) {
    test(`${file} (${capability}) returns status + attempts on a non-ok result`, () => {
      const s = src(file);
      const i = s.indexOf("if (result.status !== \"ok\")");
      expect(i).toBeGreaterThan(-1);
      const branch = s.slice(i, i + 900);
      expect(branch).toContain("status: result.status");
      expect(branch).toContain("attempts: result.attempts");
    });
  }
});

describe("the export job panel never prints a bare 'none' for the router's env list", () => {
  test('the old `|| "none named"` fallback is gone, and a registry-derived fallback took its place', () => {
    const s = src("src/components/editor/export-panel.tsx");
    expect(s).not.toContain('|| "none named"');
    expect(s).toContain("derived from the provider registry for this job, not carried by the answer above");
    expect(s).toContain("neither this answer nor the job row carried an env var name");
  });
});
