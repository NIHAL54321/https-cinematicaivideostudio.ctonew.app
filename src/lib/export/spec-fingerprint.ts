/**
 * THE FINGERPRINT OF A RESOLVED SPECIFICATION (Phase 8, block 2a).
 *
 * A job records the resolved spec it ran with, and a digest of it, so the job's
 * numbers stay the job's numbers even if the preset catalogue is edited
 * afterwards. The digest is SHA-256 over the CANONICAL JSON of the spec core —
 * keys sorted at every depth, so the same numbers always produce the same
 * digest regardless of the order they were built in.
 *
 * SERVER-SIDE ONLY: it uses node:crypto, so it is deliberately not exported from
 * the client-safe barrel. `./presets` stays pure; this is the one place the
 * digest is computed.
 */
import { createHash } from "node:crypto";

/** Stable JSON: object keys sorted at every depth, arrays kept in order. */
export function canonicalJsonString(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** SHA-256 (hex) of the canonical JSON of a payload. */
export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value)).digest("hex");
}
