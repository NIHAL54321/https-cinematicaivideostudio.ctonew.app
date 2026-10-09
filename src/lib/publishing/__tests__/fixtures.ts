/**
 * Shared fixtures for the publishing-package tests. Not a test file itself.
 *
 * Every fixture is a hand-written SOURCE (raw rows), never a package: the tests
 * derive from rows exactly the way the service does, so a fixture cannot encode
 * an expectation about a derivation it is also standing in for.
 */
import type { PublishingSource } from "../types";

export const NOW = new Date("2026-10-09T12:00:00.000Z");

/** A real project shape: 2 chapters, 3 scenes, real durations, real narration. */
export function richSource(overrides: Partial<PublishingSource> = {}): PublishingSource {
  return {
    project: {
      id: "proj_rich",
      title: "The Fall of Carthage",
      description:
        "A cinematic retelling of the last years of Carthage, from the Second Punic War to the city's destruction in 146 BC.",
      targetAspectRatio: "SIXTEEN_NINE",
      targetDurationSeconds: 900,
      updatedAt: "2026-10-08T09:30:00.000Z",
    },
    settings: {
      seoDefaultsDescription: null,
      language: "en",
      tone: "documentary",
      style: "cinematic",
      targetAudience: "history enthusiasts",
    },
    script: {
      id: "scr_rich",
      title: "Carthage: the city that refused to kneel",
      logline: "Rome demanded that Carthage disarm. Carthage refused, and the city burned for three years.",
      language: "en",
      tone: "documentary",
      style: "epic",
      targetAudience: null,
    },
    chapters: [
      {
        id: "ch_1",
        scriptId: "scr_rich",
        order: 1,
        title: "The Second Punic War",
        summary: "Hannibal crosses the Alps and Rome learns to fear Carthage.",
        scenes: [
          {
            id: "sc_1",
            order: 1,
            title: "Hannibal crosses the Alps",
            narration:
              "Hannibal crossed the Alps with elephants and a Carthaginian army that Rome had not expected to survive the crossing.",
            durationSeconds: 120,
            status: "READY",
          },
          {
            id: "sc_2",
            order: 2,
            title: "The battle of Cannae",
            narration:
              "At Cannae the Carthaginian army destroyed a Roman force far larger than itself, and Rome refused to surrender.",
            durationSeconds: 180,
            status: "READY",
          },
        ],
      },
      {
        id: "ch_2",
        scriptId: "scr_rich",
        order: 2,
        title: "The Third Punic War",
        summary: null,
        scenes: [
          {
            id: "sc_3",
            order: 1,
            title: "The siege of Carthage",
            narration:
              "The Roman siege of Carthage lasted three years, and the Carthaginian army held the walls until the last street.",
            durationSeconds: 240,
            status: "DRAFT",
          },
        ],
      },
    ],
    assets: [
      {
        id: "as_licensed",
        name: "Roman legion footage",
        kind: "STOCK",
        status: "READY",
        mimeType: "video/mp4",
        createdAt: "2026-10-01T08:00:00.000Z",
        licensing: {
          id: "lic_1",
          licenseType: "ROYALTY_FREE",
          source: "Pexels",
          attribution: "Footage by A. Camera Operator",
          licenseUrl: "https://www.pexels.com/license/",
          purchasedAt: null,
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
      },
      {
        id: "as_unlicensed",
        name: "Old map scan",
        kind: "IMAGE",
        status: "READY",
        mimeType: "image/png",
        createdAt: "2026-10-02T08:00:00.000Z",
        licensing: null,
      },
    ],
    request: { callToAction: null },
    ...overrides,
  };
}

/** A project that exists but has NOTHING to derive from: the honest empty case. */
export function emptySource(): PublishingSource {
  return {
    project: {
      id: "proj_empty",
      title: "Untitled project",
      description: null,
      targetAspectRatio: null,
      targetDurationSeconds: null,
      updatedAt: "2026-10-08T09:30:00.000Z",
    },
    settings: null,
    script: null,
    chapters: [],
    assets: [],
    request: {},
  };
}

/** A project with a real title/description but no chapters (the SEO-only case). */
export function textOnlySource(): PublishingSource {
  return {
    project: {
      id: "proj_text",
      title: "Deep sea mining explained",
      description: "What deep sea mining is, what it would cost, and who decides whether it happens.",
      targetAspectRatio: "SIXTEEN_NINE",
      targetDurationSeconds: 600,
      updatedAt: "2026-10-08T09:30:00.000Z",
    },
    settings: {
      seoDefaultsDescription: null,
      language: "en",
      tone: null,
      style: null,
      targetAudience: null,
    },
    script: null,
    chapters: [],
    assets: [],
    request: {},
  };
}
