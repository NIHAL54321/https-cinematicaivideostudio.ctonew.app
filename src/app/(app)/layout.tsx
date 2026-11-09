import { requireUser, publicUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ownerAutoLoginGate, ownerSessionMarkerText } from "@/lib/owner-session/gate";

/**
 * Protected route group. The real session check happens here (server-side,
 * against the DB) — the edge middleware only gates on cookie presence.
 *
 * OWNER AUTO SIGN-IN (Phase 8, owner-session block): the layout does NOT mint
 * anything. It reads the flag only to decide whether to show the marker, and it
 * shows it only when the flag is on AND the session belongs to the account the
 * flag names — so a session that arrived some other way is never labelled as a
 * bypass.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const user = publicUser(session.user);
  const gate = ownerAutoLoginGate();
  const ownerMarker = gate.enabled && user.email === gate.email ? ownerSessionMarkerText(gate.email) : null;
  return (
    <AppShell user={user} ownerMarker={ownerMarker}>
      {children}
    </AppShell>
  );
}
