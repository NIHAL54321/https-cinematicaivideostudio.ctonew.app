import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { MediaLibraryView } from "@/components/media/media-library";

export const metadata = { title: "Media Library" };

/**
 * Media Library — Phase 3 Block 4.
 *
 * Server page: ensures the signed-session and resolves a project to attach
 * uploads to (assets are always tenant-scoped). Rendering the grid, filters,
 * favorites/collections, renames and uploads is delegated to the client view
 * which talks to the real /api/media/library* routes.
 */
export default async function MediaLibraryPage() {
  const session = await requireUser();
  // Uploads are FK'd to a project. Provide the user's most recent project, or
  // create one real "Media Library" project so uploads always have a home
  // (never fabricated — a genuine row the user owns).
  let project = await prisma.project.findFirst({
    where: { userId: session.userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { userId: session.userId, title: "Media Library" },
      select: { id: true },
    });
  }

  return (
    <div>
      <PageHeader
        title="Media Library"
        description="Every image, video, voiceover, music track and subtitle you've created, licensed or uploaded — searchable, taggable, and organized into collections."
      />
      <MediaLibraryView projectId={project.id} />
    </div>
  );
}
