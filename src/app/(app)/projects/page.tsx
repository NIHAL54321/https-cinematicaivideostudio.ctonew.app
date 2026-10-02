import { requireUser } from "@/lib/auth";
import { listProjects, trashCount } from "@/lib/projects";
import { ProjectList } from "@/components/projects/project-list";

export const metadata = { title: "My Projects" };

export default async function ProjectsPage() {
  const session = await requireUser();
  const userId = session.userId;
  const [projects, count] = await Promise.all([listProjects(userId, false), trashCount(userId)]);

  return <ProjectList projects={projects} trashCount={count} />;
}
