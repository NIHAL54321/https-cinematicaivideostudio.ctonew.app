/**
 * Query parsing for the music routes — BLOCK M1, 2026-11-17. Pure, no IO.
 *
 * Kept out of the route handler so the validation rules are unit-tested
 * without a request: an empty `q` is a 400, a `limit` above 50 is a 400, and a
 * limit that is not a positive integer is a 400. The route does the auth; this
 * does the shape.
 */
import { ApiError } from "@/lib/api";
import { INTENDED_USES, type IntendedUse } from "./providers/types";

export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;

export interface ParsedMusicSearch {
  q: string;
  genre: string | null;
  mood: string | null;
  limit: number;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function parseMusicSearchParams(params: URLSearchParams): ParsedMusicSearch {
  const q = clean(params.get("q"));
  if (!q) {
    throw new ApiError(400, "A search needs a query — `q` was empty.", "bad_query");
  }

  const rawLimit = clean(params.get("limit"));
  let limit = DEFAULT_SEARCH_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      throw new ApiError(400, "`limit` must be a whole number.", "bad_limit");
    }
    limit = Number(rawLimit);
    if (limit < 1) {
      throw new ApiError(400, "`limit` must be at least 1.", "bad_limit");
    }
    if (limit > MAX_SEARCH_LIMIT) {
      throw new ApiError(400, `\`limit\` may not exceed ${MAX_SEARCH_LIMIT}.`, "bad_limit");
    }
  }

  return { q, genre: clean(params.get("genre")), mood: clean(params.get("mood")), limit };
}

/** An `intendedUse` value, or null when the string is not one of the three. */
export function parseIntendedUse(value: string | null | undefined): IntendedUse | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return (INTENDED_USES as readonly string[]).includes(trimmed) ? (trimmed as IntendedUse) : null;
}
