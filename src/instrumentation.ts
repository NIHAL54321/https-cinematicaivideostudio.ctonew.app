/**
 * Next.js instrumentation hook — runs ONCE when the server process starts.
 *
 * Its whole job in this block is to make owner auto sign-in LOUD. A deployment
 * where anyone who can reach the port is signed in as the owner must say so in
 * the log at the moment it starts, not only in a page a visitor might not open.
 *
 * The import is dynamic and guarded by NEXT_RUNTIME so that this file stays
 * edge-safe: only the Node server loads the gate, and the gate itself imports
 * nothing at all (no Prisma, no next/headers) so nothing is dragged in either
 * way.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ownerAutoLoginGate, ownerAutoLoginStartupWarning } = await import("@/lib/owner-session/gate");
  const gate = ownerAutoLoginGate();
  if (gate.enabled) {
    console.warn(ownerAutoLoginStartupWarning(gate.email));
  } else {
    console.log(`[owner-session] owner auto sign-in is OFF (${gate.reason}) — anonymous requests are 401 as usual`);
  }
}
