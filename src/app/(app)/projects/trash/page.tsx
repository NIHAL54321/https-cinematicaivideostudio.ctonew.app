import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { TrashList } from "@/components/projects/trash-list";

export const metadata = { title: "Trash" };

export default async function ProjectsTrashPage() {
  const session = await requireUser();
  const projects = await listProjects(session.userId, true);

  return <TrashList projects={projects} />;
}
