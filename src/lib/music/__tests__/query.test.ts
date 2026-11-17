/**
 * Route validation and route auth — no network, no database.
 *
 * The parsing rules live in `../query.ts` so they are testable without a
 * request. The auth assertion reads the route files themselves: every music
 * route must resolve the session before it does anything else, and a source
 * assertion is the only way to check that without standing up Next's request
 * context.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "@/lib/api";
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, parseIntendedUse, parseMusicSearchParams } from "../query";

function params(record: Record<string, string>): URLSearchParams {
  return new URLSearchParams(record);
}

describe("parseMusicSearchParams", () => {
  test("a query with no filters gets the default limit", () => {
    expect(parseMusicSearchParams(params({ q: "cinematic" }))).toEqual({
      q: "cinematic",
      genre: null,
      mood: null,
      limit: DEFAULT_SEARCH_LIMIT,
    });
  });

  test("genre, mood and limit pass through, trimmed", () => {
    expect(
      parseMusicSearchParams(params({ q: "  lofi ", genre: " Electronic ", mood: "Peaceful", limit: "7" })),
    ).toEqual({ q: "lofi", genre: "Electronic", mood: "Peaceful", limit: 7 });
  });

  test("an empty q is a 400", () => {
    for (const value of ["", "   "]) {
      let caught: unknown = null;
      try {
        parseMusicSearchParams(params({ q: value }));
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).status).toBe(400);
    }
  });

  test("a missing q is a 400", () => {
    expect(() => parseMusicSearchParams(params({ genre: "Electronic" }))).toThrow(ApiError);
  });

  test("a limit above 50 is a 400", () => {
    let caught: unknown = null;
    try {
      parseMusicSearchParams(params({ q: "cinematic", limit: String(MAX_SEARCH_LIMIT + 1) }));
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).status).toBe(400);
    expect((caught as ApiError).message).toContain("50");
  });

  test("limit 50 is accepted — the boundary is the provider's, not ours", () => {
    expect(parseMusicSearchParams(params({ q: "x", limit: "50" })).limit).toBe(50);
  });

  test("a non-numeric or zero limit is a 400", () => {
    for (const value of ["ten", "0", "-3", "1.5"]) {
      expect(() => parseMusicSearchParams(params({ q: "x", limit: value }))).toThrow(ApiError);
    }
  });
});

describe("parseIntendedUse", () => {
  test("the three uses are accepted", () => {
    expect(parseIntendedUse("commercial")).toBe("commercial");
    expect(parseIntendedUse("personal")).toBe("personal");
    expect(parseIntendedUse("editorial")).toBe("editorial");
  });

  test("anything else is null, never a default", () => {
    expect(parseIntendedUse("broadcast")).toBeNull();
    expect(parseIntendedUse("")).toBeNull();
    expect(parseIntendedUse(null)).toBeNull();
  });
});

describe("every music route resolves the session first", () => {
  const routes = [
    "../../../app/api/studio/music/search/route.ts",
    "../../../app/api/studio/music/preview/[provider]/[id]/route.ts",
    "../../../app/api/projects/[id]/music/route.ts",
    "../../../app/api/projects/[id]/music/select/route.ts",
  ];

  for (const relative of routes) {
    test(relative.split("/api/")[1], () => {
      const source = readFileSync(join(import.meta.dir, relative), "utf8");
      // Only the handler bodies count: an import statement mentions the store
      // before any handler runs, and that is not "doing work before auth".
      const body = source.slice(source.indexOf("export async function"));
      expect(body).toContain("requireApiUser()");
      const authAt = body.indexOf("requireApiUser()");
      const workAt = Math.min(
        ...[body.indexOf("prismaMusicStore"), body.indexOf("musicProvider("), body.indexOf("searchMusic(")]
          .filter((index) => index >= 0)
          .concat([Number.POSITIVE_INFINITY]),
      );
      expect(authAt).toBeGreaterThan(-1);
      expect(authAt).toBeLessThan(workAt);
    });
  }
});
