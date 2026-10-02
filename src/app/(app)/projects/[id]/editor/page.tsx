import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createPrismaEditorStore } from "@/lib/editor/store";
import { runEditorAction } from "@/lib/editor/service";
import type { SceneInput, Timeline } from "@/lib/editor";
import { EditorClient } from "./editor-client";

/**
 * Phase 5 Block 1 — the video editor page (server side).
 *
 * The page loads the SAME way the API does: it calls `runEditorAction` with the
 * Prisma store, so what the editor first renders is exactly what GET-equivalent
 * `action: "load"` returns (saved timeline when present, otherwise rebuilt from
 * the project's scenes). A foreign or missing project is a 404 — tenancy is
 * enforced in the store, server-side, before any HTML is produced.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const session = await requireUser();
  try {
    const store = createPrismaEditorStore();
    const project = await store.findOwnedProject(session.userId, id);
    return { title: project ? `${project.title} — Editor` : "Editor" };
  } catch {
    return { title: "Editor" };
  }
}

export default async function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const store = createPrismaEditorStore();

  const loaded = await runEditorAction(store, session.userId, { action: "load", projectId: id });
  if (loaded.status === 404) notFound();
  if (loaded.status !== 200) {
    throw new Error(typeof loaded.body.error === "string" ? loaded.body.error : "Could not load the editor.");
  }

  const timeline = loaded.body.timeline as Timeline;
  const projectTitle = typeof loaded.body.projectTitle === "string" ? loaded.body.projectTitle : "Untitled Video";
  const source = loaded.body.source === "saved" ? "saved" : "scenes";
  const sceneRows = await store.listScenes(id);
  const scenes: SceneInput[] = sceneRows.map((s) => ({
    id: s.id,
    title: s.title,
    narration: s.narration,
    durationSeconds: s.durationSeconds,
  }));

  return (
    <EditorClient
      projectId={id}
      projectTitle={projectTitle}
      initialTimeline={timeline}
      initialSource={source}
      scenes={scenes}
    />
  );
}
