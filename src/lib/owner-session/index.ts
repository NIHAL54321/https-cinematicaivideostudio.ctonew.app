/**
 * OWNER AUTO SIGN-IN — public surface (Phase 8, owner-session block).
 *
 * `gate.ts` is import-safe anywhere (it imports nothing). `store.ts` pulls in
 * Prisma and must only be imported from Node-runtime code — a route handler or a
 * server component. Middleware runs on the edge runtime, where Prisma does not
 * run, so middleware must never import the store; it does not need to, because
 * it never mints anything.
 */
export {
  ownerAutoLoginGate,
  ownerAutoLoginStartupWarning,
  ownerSessionMarkerText,
  ownerSessionSignOutNote,
  safeOwnerNextPath,
  type OwnerGate,
} from "./gate";
export {
  ensureOwnerAccount,
  mintOwnerSession,
  type OwnerSessionDeps,
  type OwnerSessionOutcome,
  type OwnerSessionStore,
} from "./mint";
