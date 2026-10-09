import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { auditStoredPackage } from "@/lib/publishing/package";
import { createPrismaPublishStore } from "@/lib/publishing/store";
import { buildCreatorStudioView, buildEmptyCreatorStudioView } from "@/lib/publishing/studio-view";
import { CreatorStudioClient } from "./creator-studio-client";

/**
 * Phase 7 Block 2 — /projects/[id]/creator-studio.
 *
 * WHY THIS ROUTE: the publishing package belongs to ONE project (chapters, its
 * assets and its licence rows are all project-scoped), and this app already keeps
 * a project's surfaces under /projects/[id]/… — the editor is
 * /projects/[id]/editor, and the project page links to it. So the Creator Studio
 * sits beside the editor rather than in the flat /ai/* studio list, which is for
 * project-less tools, and the project page links to it the same way it links to
 * the editor.
 *
 * WHAT THIS PAGE DOES: it reads the stored package for this project (newest
 * version, appends only) and renders it. It does not derive anything itself and
 * it does not talk to a provider: the build action is a POST to the app's own
 * /api/studio/publishing route, which derives the package from this project's
 * rows and saves a new version. The stored bytes are re-audited here, on read,
 * and that result is shown on the page.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  try {
    const project = await createPrismaPublishStore().findOwnedProject(session.userId, id);
    return { title: project ? `${project.title} — Creator Studio` : "Creator Studio" };
  } catch {
    return { title: "Creator Studio" };
  }
}

export default async function CreatorStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const store = createPrismaPublishStore();

  const project = await store.findOwnedProject(session.userId, id);
  if (!project) notFound();

  const [versions, saved] = await Promise.all([store.listPackages(id), store.latestPackage(id)]);

  if (!saved) {
    return (
      <CreatorStudioClient
        projectId={id}
        view={buildEmptyCreatorStudioView({ projectId: id, projectTitle: project.title, versions })}
      />
    );
  }

  // The same check the package ran on itself, re-run on the stored bytes. Its
  // result is rendered on the page, including any violation it finds.
  const reAudit = auditStoredPackage(saved.payload, { now: new Date() });

  const view = buildCreatorStudioView({
    projectId: id,
    package: saved.payload,
    version: saved.version,
    savedPackageId: saved.id,
    payloadBytes: saved.payloadBytes,
    versions,
    reAudit,
  });

  return <CreatorStudioClient projectId={id} view={view} />;
}
