import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { getProjectDetail, listVersions } from "@/lib/projects";
import { ProjectWorkspace } from "@/components/projects/workspace";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  try {
    const project = await getProjectDetail(session.userId, id);
    return { title: `${project.title} — Project` };
  } catch {
    return { title: "Project" };
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const userId = session.userId;

  let project;
  let versions;
  try {
    [project, versions] = await Promise.all([getProjectDetail(userId, id), listVersions(userId, id)]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return <ProjectWorkspace project={project} initialVersions={versions} />;
}
