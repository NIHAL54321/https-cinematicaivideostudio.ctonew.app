import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { createPrismaEditorStore } from "@/lib/editor/store";
import { runEditorAction } from "@/lib/editor/service";
export const runtime = "nodejs";
/**
 * POST /api/studio/editor — Phase 5 editor (Blocks 1 + 2 + 3 + 4 + 5a + 5b) +
 * Phase 6 Block 1 export & finishing.
 *
 * Actions: build | load | save | createVersion | versions | restoreVersion |
 *          sceneControl | autoTransitions | autoEdit | analyzePacing |
 *          listGrades | applyGrade | resetGrade | renderGradePreview |
 *          listShortsMoments | configureShortsTargets | applyShorts | clearShorts |
 *          listFrameFormats | planReframe | applyReframe | resetReframe |
 *          listExportPresets | planExport | applyExportPreset | clearExportPreset |
 *          planSidecars | checkPublishReadiness |
 *          createExportJob | listExportJobs | getExportJob.
 * All of the logic lives in src/lib/editor/service.ts (store-injected, so it is
 * covered by contract tests without a database); this route only wires the
 * Prisma store in and maps `{ status, body }` onto a JSON response.
 *
 * Block 1 is deterministic timeline editing. Block 2 adds the seven scene
 * controls (`sceneControl` — deterministic plans plus HONEST provider gates for
 * image/voice/music generation: `connected: false` and the env var NAMES a
 * server operator must set, never values) and the conservative auto-transition
 * policy (`autoTransitions`). Block 4 added the colour system
 * (listGrades/applyGrade/resetGrade/renderGradePreview → src/lib/color) and
 * Block 5a adds long-form → shorts repurposing
 * (listShortsMoments/configureShortsTargets/applyShorts/clearShorts →
 * src/lib/repurpose): deterministic moment analysis over the script and the
 * timeline plus real clip windows per platform target, with honest gates for
 * media analysis and media rendering. Block 5b adds smart 16:9 → 9:16 reframing
 * and multi-format output (listFrameFormats/planReframe/applyReframe/resetReframe
 * → src/lib/framing): real cover-crop geometry per clip and per delivery format
 * (crop window, scale/upscale, travel, safe areas, per-keyframe path), stated
 * framing policies that cite the data behind each choice, and per-project /
 * per-scene / per-clip overrides. The subject anchor is UNKNOWN — no face,
 * chart or text position exists anywhere in this app — so the plan uses a stated
 * rule anchor and carries the honest detector gate (env var NAMES only); no
 * detection box is ever produced and no frame is rendered. Phase 6 Block 1 adds
 * the export & finishing spec layer (listExportPresets/planExport/
 * applyExportPreset/clearExportPreset → src/lib/export): the eight delivery
 * presets' real container/codec/resolution/frame-rate/bitrate/audio/loudness and
 * SDR-or-HDR colour tagging, the size ESTIMATE from a stated formula, the
 * deliverable manifest and the persisted preset choice
 * (ProjectSettings.extra.exportPreset, re-apply idempotent). Encoding, muxing,
 * HDR metadata authoring and uploads need a video-processing provider and are
 * gated with `connected: false` and the DERIVED registry env var names for
 * capability `video_enhancement` (`REPLICATE_API_TOKEN` / `RUNWAY_API_KEY`) —
 * derived from src/lib/ai/providers/{env-keys,capability-env}.ts, never a
 * literal list here, so no gate can name a variable no code reads. Nothing on
 * this endpoint fabricates media,
 * transcripts, detections, statistics or files: every export response reports
 * `filesProduced: 0`.
 *
 * Phase 6 Block 5 adds the export JOB handoff (createExportJob/listExportJobs/
 * getExportJob → src/lib/export/job-service.ts): creating a job freezes a
 * SNAPSHOT of the request (applied presets, resolved duration + its source,
 * every output's full spec, each sidecar's content state, the per-platform
 * readiness verdicts) and hands the REAL task — capability `video_enhancement`,
 * type ENHANCE_VIDEO, carrying the preset's own parameters and the sidecars to
 * mux — to the AI Model Orchestrator instead of a hand-rolled check. With no
 * provider connected the job stores the router's own "Provider Not Connected"
 * answer VERBATIM and lands in the honest `blocked` state; the states only a
 * connected provider could reach (`handed_off`, `provider_failed`) are declared
 * unreachable rather than simulated, and no progress, percentage, ETA or
 * completion field is ever populated (they are all null, `filesProduced: 0`).
 * The export surface's gate and the router's own answer now come from the SAME
 * derivation (capability `video_enhancement` → replicate/runway slots →
 * `REPLICATE_API_TOKEN` / `RUNWAY_API_KEY`), so they cannot contradict each
 * other in one response.
 *
 * `versions` lists ONLY editor-format snapshots: Phase 1-3 project snapshots
 * share the ProjectVersion table but can never be restored as a timeline, so
 * they are hidden (and reported as `hiddenCount`).
 */
export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:editor", 60);
    const body = await readJson(req);
    const result = await runEditorAction(createPrismaEditorStore(), userId, body);
    return ok(result.body, result.status);
  } catch (err) {
    return apiError(err);
  }
}
