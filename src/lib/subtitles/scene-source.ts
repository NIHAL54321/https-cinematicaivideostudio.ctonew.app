/**
 * Reads a project's Scene rows as the caption derivation's input.
 * Phase 8 Audio/Subtitle/Thumbnail block, 2026-11-15.
 *
 * Server-side only. Ownership is enforced by `getScriptTree`, which resolves the
 * project through `getOwnedProject` — a project belonging to another account is
 * a 404, never a 403 and never someone else's captions.
 *
 * The rows are read exactly as stored: a scene's narration is the text in the
 * Scene table, and its duration is the `durationSeconds` on that row (null when
 * the row records none — never a default this module invents).
 */
import { prisma } from "@/lib/db";
import { getScriptTree } from "@/lib/studio/pipeline";
import type { SceneSource } from "./from-scenes";

export interface ProjectSceneSource {
  projectTitle: string;
  scenes: SceneSource[];
  /** True when the project has a Script row but no Scene rows under it. */
  hasScript: boolean;
}

export async function projectSceneSource(userId: string, projectId: string): Promise<ProjectSceneSource> {
  const tree = await getScriptTree(userId, projectId);
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { title: true },
  });

  const scenes: SceneSource[] = [];
  let number = 0;
  for (const chapter of tree.script?.chapters ?? []) {
    for (const scene of chapter.scenes) {
      number += 1;
      scenes.push({
        id: scene.id,
        number,
        title: scene.title,
        narration: scene.narration,
        durationSeconds: scene.durationSeconds,
      });
    }
  }

  return {
    projectTitle: project?.title ?? tree.script?.title ?? "Untitled project",
    scenes,
    hasScript: Boolean(tree.script),
  };
}
