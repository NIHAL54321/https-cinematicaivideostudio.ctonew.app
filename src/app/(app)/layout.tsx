import { requireUser, publicUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

/**
 * Protected route group. The real session check happens here (server-side,
 * against the DB) — the edge middleware only gates on cookie presence.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const user = publicUser(session.user);
  return <AppShell user={user}>{children}</AppShell>;
}
