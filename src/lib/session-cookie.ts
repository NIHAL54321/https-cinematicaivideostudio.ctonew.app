/**
 * Shared constants that are safe for every runtime (Node server, Edge
 * middleware, client). Do NOT import server-only modules (db, crypto) here —
 * that breaks the Edge middleware bundle.
 */
export const SESSION_COOKIE = "cavs_session";
