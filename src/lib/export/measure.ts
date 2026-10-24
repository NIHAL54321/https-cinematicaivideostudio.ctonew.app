/**
 * READING A PROJECT'S OWN FACTS FOR THE RECOMMENDATION (Phase 8, block 2a).
 *
 * `./recommend` is pure: it takes a measurement and returns a recommendation.
 * This module does the measuring, and it measures ONLY what the project's rows
 * actually hold:
 *
 *   - duration      → the sum of `Scene.durationSeconds`. A scene with no
 *                     declared duration contributes 0 and the sum is reported as
 *                     null when NO scene declares one — a total of 0 s is not a
 *                     measurement of a video.
 *   - aspect        → `Project.targetAspectRatio`, falling back to
 *                     `ProjectSettings.defaultAspectRatio`. The source is named.
 *   - scenes        → a count of Scene rows.
 *   - resolution    → the largest `Asset.width` / `Asset.height` the project's
 *                     own asset rows declare. Null when none declares any —
 *                     which is the honest answer for an asset that was never
 *                     probed, and the recommendation marks itself partial.
 *
 * Every read is tenant-scoped: a project belonging to another account is
 * reported as absent, exactly like a project that does not exist.
 */
import { prisma } from "@/lib/db";
import type { ProjectMeasurement } from "./recommend";

type Aspect = NonNullable<ProjectMeasurement["aspect"]>;

const ASPECT_MAP: Record<string, Aspect> = {
  SIXTEEN_NINE: "16:9",
  NINE_SIXTEEN: "9:16",
  ONE_ONE: "1:1",
  FOUR_FIVE: "4:5",
};

export async function measureProject(input: {
  projectId: string;
  userId: string;
  targetPlatform?: string | null;
}): Promise<ProjectMeasurement | null> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId, deletedAt: null },
    select: {
      id: true,
      title: true,
      targetAspectRatio: true,
      targetDurationSeconds: true,
      settings: { select: { defaultAspectRatio: true } },
      scenes: { select: { durationSeconds: true } },
      assets: { select: { width: true, height: true } },
    },
  });
  if (!project) return null;

  const declared = project.scenes.map((s) => s.durationSeconds).filter((d): d is number => typeof d === "number");
  const durationSeconds = declared.length > 0 ? declared.reduce((n, d) => n + d, 0) : null;

  const aspectKey = project.targetAspectRatio ?? project.settings?.defaultAspectRatio ?? null;
  const aspect = aspectKey ? (ASPECT_MAP[aspectKey] ?? null) : null;
  const aspectSource = project.targetAspectRatio
    ? "Project.targetAspectRatio"
    : project.settings?.defaultAspectRatio
      ? "ProjectSettings.defaultAspectRatio (the app's own default — the project itself sets no aspect)"
      : "nothing declares an aspect ratio";

  const sized = project.assets.filter((a) => typeof a.width === "number" && typeof a.height === "number");
  const assetMaxWidthPx = sized.length > 0 ? Math.max(...sized.map((a) => a.width as number)) : null;
  const assetMaxHeightPx = sized.length > 0 ? Math.max(...sized.map((a) => a.height as number)) : null;

  return {
    projectId: project.id,
    title: project.title,
    targetPlatform: input.targetPlatform ?? null,
    durationSeconds,
    targetDurationSeconds: project.targetDurationSeconds ?? null,
    sceneCount: project.scenes.length,
    aspect,
    aspectSource,
    assetCount: project.assets.length,
    assetMaxWidthPx,
    assetMaxHeightPx,
    measuredAt: new Date().toISOString(),
  };
}
