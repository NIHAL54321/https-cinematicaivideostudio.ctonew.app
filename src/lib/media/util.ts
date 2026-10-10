/**
 * JSON-safe deep clone: converts BigInt → number (or string when out of safe
 * range) so Prisma rows (which return BigInt for BigInt columns like
 * sizeBytes) can be serialized by NextResponse.json.
 */
export function jsonSafe(value: unknown, visited = new WeakSet<object>()): unknown {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (value === null || value === undefined) return value;
  // A Date has no own enumerable entries, so the object branch below turned one
  // into `{}` — the media routes' licence dates (purchasedAt/expiresAt) reached
  // the caller as empty objects, which reads as "no date recorded" for a row
  // that really stores one. Dates are serialised as ISO strings instead.
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (visited.has(value)) return value; // avoid cycles
  visited.add(value);
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v, visited));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = jsonSafe(v, visited);
  }
  return out;
}
