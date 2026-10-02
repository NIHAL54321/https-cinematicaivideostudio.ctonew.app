import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import {
  getBrandKit,
  resolveKitAssetUrls,
  toBrandKitApi,
  type BrandKitApi,
} from "@/lib/brandkit";
import { listProjects, type ProjectSummary } from "@/lib/projects";
import { BrandKitEditor } from "@/components/brand/brand-kit-editor";

export const metadata = { title: "Brand Kit" };

/**
 * Brand Kit — server page.
 *
 * Loads the user's real, persisted kit (if any) and their projects, then
 * hands both to the client editor. Asset uploads are attached to a real
 * project (Asset rows are FK'd to projects), reusing the same pattern as the
 * media library: latest project, or a genuine "Brand Kit" project as a home.
 */
export default async function BrandKitPage() {
  const session = await requireUser();
  const userId = session.userId;

  let kit: BrandKitApi | null = null;
  const row = await getBrandKit(userId);
  if (row) {
    const urls = await resolveKitAssetUrls(userId, row);
    kit = toBrandKitApi(row, urls);
  }

  const projects = await listProjects(userId, false);

  let uploadProjectId = projects[0]?.id ?? null;
  if (!uploadProjectId) {
    const created = await prisma.project.create({
      data: { userId, title: "Brand Kit" },
      select: { id: true },
    });
    uploadProjectId = created.id;
  }

  return (
    <div>
      <PageHeader
        title="Brand Kit"
        description="One identity for every video — logo, colors, fonts, intro/outro, watermark, and default voice, subtitle, music and thumbnail preferences. New projects inherit these automatically, or apply the kit to an existing project."
      />
      <BrandKitEditor
        initialKit={kit}
        projects={projects.map((p) => ({ id: p.id, title: p.title }))}
        uploadProjectId={uploadProjectId}
      />
    </div>
  );
}
