/**
 * The music service — the licence refusal ("writes zero rows"), the tenancy 404,
 * the counts, and the clear. Driven by a memory store and a fake provider, so no
 * network and no database is touched.
 *
 * The memory store is typed as `MusicStore`, so a contract change is a type
 * error here rather than a runtime surprise in a route.
 */
import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import { evaluateLicence } from "../licence";
import {
  NO_MUSIC_IN_DELIVERY_NOTE,
  buildSearchView,
  clearMusic,
  loadMusicView,
  projectIntendedUse,
  searchMusic,
  selectMusic,
  type MusicSelectionView,
  type MusicStore,
  type WriteSelectionInput,
} from "../service";
import type { IntendedUse, MusicProvider, MusicProviderTrack } from "../providers/types";

class MemoryStore implements MusicStore {
  projects = new Map<string, { userId: string; musicDefaults: unknown }>();
  selection: MusicSelectionView | null = null;
  writes: WriteSelectionInput[] = [];
  clearCalls = 0;
  defaultsPatches: Array<Record<string, unknown>> = [];

  addProject(projectId: string, userId: string, musicDefaults: unknown = null) {
    this.projects.set(projectId, { userId, musicDefaults });
  }

  async readProject(userId: string, projectId: string) {
    const project = this.projects.get(projectId);
    if (!project || project.userId !== userId) return null;
    return { id: projectId, musicDefaults: project.musicDefaults };
  }

  async readSelection() {
    return this.selection;
  }

  async countMusicAssets() {
    return this.selection ? 1 : 0;
  }

  async writeSelection(input: WriteSelectionInput) {
    this.writes.push(input);
    this.selection = {
      assetId: "asset-1",
      provider: input.track.providerId,
      providerTrackId: input.track.providerTrackId,
      title: input.track.title,
      artist: input.track.artist,
      artistHandle: input.track.artistHandle,
      durationSeconds: input.track.durationSeconds,
      genre: input.track.genre,
      mood: input.track.mood,
      licenceText: input.track.licenceText,
      verdict: input.verdict,
      intendedUse: input.intendedUse,
      evaluatedAt: input.evaluatedAt,
      permalink: input.track.permalink,
    };
    return this.selection;
  }

  async clearSelection() {
    this.clearCalls += 1;
    const had = this.selection ? 1 : 0;
    this.selection = null;
    return had;
  }

  async mergeProjectMusicDefaults(projectId: string, patch: Record<string, unknown>) {
    this.defaultsPatches.push(patch);
    const project = this.projects.get(projectId);
    if (project) {
      const existing =
        project.musicDefaults && typeof project.musicDefaults === "object"
          ? (project.musicDefaults as Record<string, unknown>)
          : {};
      project.musicDefaults = { ...existing, ...patch };
    }
  }
}

function providerTrack(overrides: Partial<MusicProviderTrack> = {}): MusicProviderTrack {
  return {
    providerId: "audius",
    providerTrackId: "93v00",
    title: "Star Hunter",
    artist: "Blythe",
    artistHandle: "brokenblythe",
    durationSeconds: 292,
    genre: "Soundtrack",
    mood: "Gritty",
    licenceText: "Attribution CC BY",
    isStreamable: true,
    isGated: false,
    permalink: "/brokenblythe/star-hunter",
    ...overrides,
  };
}

function fakeProvider(track: MusicProviderTrack): MusicProvider & { trackCalls: string[]; searchCalls: number } {
  const state = { trackCalls: [] as string[], searchCalls: 0 };
  return {
    id: "audius",
    label: "Audius",
    requiredEnv: ["AUDIUS_APP_NAME"],
    isConfigured: () => true,
    async search() {
      state.searchCalls += 1;
      return [track];
    },
    async track(id: string) {
      state.trackCalls.push(id);
      return track;
    },
    previewUrl: (id: string) => `https://provider.invalid/${id}`,
    licenceVerdict: (t, use: IntendedUse) => evaluateLicence(t, use),
    get trackCalls() {
      return state.trackCalls;
    },
    get searchCalls() {
      return state.searchCalls;
    },
  };
}

describe("selectMusic — the permitted path", () => {
  test("re-fetches the track by id and writes exactly one selection", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    const provider = fakeProvider(providerTrack());

    const result = await selectMusic(
      { userId: "u1", projectId: "p1", providerId: "audius", providerTrackId: "93v00" },
      { store, provider },
    );

    expect(provider.trackCalls).toEqual(["93v00"]);
    expect(store.writes.length).toBe(1);
    expect(store.writes[0].track.licenceText).toBe("Attribution CC BY");
    expect(store.writes[0].verdict.permitted).toBe(true);
    expect(result.selection.verdict.basis).toBe("uploader-claimed");
    expect(result.view.selection?.providerTrackId).toBe("93v00");
    expect(result.view.counts.musicAssets).toBe(1);
    expect(result.view.counts.exportAllowed).toBe(1);
    expect(result.view.counts.previewOnly).toBe(0);
  });

  test("the per-project preference is merged, not overwritten", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1", { mood: "epic", volume: 70 });
    await selectMusic(
      { userId: "u1", projectId: "p1", providerId: "audius", providerTrackId: "93v00" },
      { store, provider: fakeProvider(providerTrack()) },
    );
    const patch = store.defaultsPatches[0];
    expect(patch.intendedUse).toBe("commercial");
    expect((patch.selection as Record<string, unknown>).providerTrackId).toBe("93v00");
    expect(store.projects.get("p1")?.musicDefaults).toEqual({
      mood: "epic",
      volume: 70,
      intendedUse: "commercial",
      selection: patch.selection,
    });
  });
});

describe("selectMusic — the refusal writes nothing", () => {
  test("an all-rights-reserved track is a 422 with the verdict's own reason", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    const provider = fakeProvider(providerTrack({ licenceText: "All rights reserved" }));

    let caught: unknown = null;
    try {
      await selectMusic(
        { userId: "u1", projectId: "p1", providerId: "audius", providerTrackId: "93v00" },
        { store, provider },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(422);
    expect((caught as ApiError).message).toBe("all rights reserved — no sync or commercial use granted");
    expect((caught as ApiError).code).toBe("licence_refused");
    // Zero rows: no write was attempted and no preference was merged.
    expect(store.writes.length).toBe(0);
    expect(store.selection).toBeNull();
    expect(store.defaultsPatches.length).toBe(0);
  });

  test("a track with no licence text writes nothing either", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    const provider = fakeProvider(providerTrack({ licenceText: null }));
    await expect(
      selectMusic(
        { userId: "u1", projectId: "p1", providerId: "audius", providerTrackId: "93v00" },
        { store, provider },
      ),
    ).rejects.toThrow("no licence stated by the uploader");
    expect(store.writes.length).toBe(0);
  });
});

describe("tenancy", () => {
  test("a foreign project id is a 404 and the provider is never called", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "someone-else");
    const provider = fakeProvider(providerTrack());

    let caught: unknown = null;
    try {
      await selectMusic(
        { userId: "u1", projectId: "p1", providerId: "audius", providerTrackId: "93v00" },
        { store, provider },
      );
    } catch (err) {
      caught = err;
    }

    expect((caught as ApiError).status).toBe(404);
    expect((caught as ApiError).message).toBe("Project not found.");
    expect(provider.trackCalls).toEqual([]);
    expect(store.writes.length).toBe(0);
  });

  test("reading a foreign project's music view is a 404, not a view with no detail", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "someone-else");
    await expect(loadMusicView({ userId: "u1", projectId: "p1" }, { store })).rejects.toThrow("Project not found.");
  });
});

describe("clearMusic", () => {
  test("deletes the selection and returns the view with none", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    await selectMusic(
      { userId: "u1", projectId: "p1", providerId: "audius", providerTrackId: "93v00" },
      { store, provider: fakeProvider(providerTrack()) },
    );
    const result = await clearMusic({ userId: "u1", projectId: "p1" }, { store });
    expect(result.deleted).toBe(1);
    expect(result.view.selection).toBeNull();
    expect(result.view.counts.musicAssets).toBe(0);
  });

  test("clearing when there is nothing selected reports zero", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    const result = await clearMusic({ userId: "u1", projectId: "p1" }, { store });
    expect(result.deleted).toBe(0);
  });
});

describe("the view's facts", () => {
  test("the default intended use is commercial and the note says no music is delivered", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    const view = await loadMusicView({ userId: "u1", projectId: "p1" }, { store });
    expect(view.intendedUse).toBe("commercial");
    expect(view.note).toBe(NO_MUSIC_IN_DELIVERY_NOTE);
    expect(view.note).toContain("No music is in any delivered file yet");
    expect(view.licenceNote).toContain("not a verified clearance");
  });

  test("a stored preference wins over the default", () => {
    expect(projectIntendedUse({ intendedUse: "personal" })).toBe("personal");
    expect(projectIntendedUse({ intendedUse: "not-a-use" })).toBe("commercial");
    expect(projectIntendedUse(null)).toBe("commercial");
  });

  test("every provider slot is reported with its env names and whether it is configured", async () => {
    const store = new MemoryStore();
    store.addProject("p1", "u1");
    const view = await loadMusicView({ userId: "u1", projectId: "p1" }, { store });
    expect(view.providers.map((p) => p.id)).toEqual(["audius", "epidemic", "unminus"]);
    expect(view.providers[0].configured).toBe(true);
    expect(view.providers[0].requiredEnv).toEqual(["AUDIUS_APP_NAME", "AUDIUS_API_KEY"]);
    expect(view.providers[1].configured).toBe(false);
    expect(view.providers[1].requiredEnv).toEqual(["EPIDEMIC_API_KEY", "EPIDEMIC_PARTNER_ID"]);
  });
});

describe("searchMusic and buildSearchView", () => {
  test("counts and facets are counted from the rows, not from a constant", () => {
    const provider = fakeProvider(providerTrack());
    const view = buildSearchView(
      provider,
      { q: "cinematic", genre: null, mood: null, limit: 3 },
      "commercial",
      [
        providerTrack({ providerTrackId: "a", licenceText: "Attribution CC BY", genre: "Electronic", mood: "Peaceful" }),
        providerTrack({ providerTrackId: "b", licenceText: "All rights reserved", genre: "Soundtrack", mood: "Gritty" }),
        providerTrack({ providerTrackId: "c", licenceText: null, genre: null, mood: null }),
      ],
    );
    expect(view.counts).toEqual({ total: 3, exportAllowed: 1, previewOnly: 2 });
    expect(view.facets.genres).toEqual(["Electronic", "Soundtrack"]);
    expect(view.facets.moods).toEqual(["Gritty", "Peaceful"]);
    expect(view.tracks.map((r) => r.verdict.permitted)).toEqual([true, false, false]);
  });

  test("searchMusic asks the provider and stamps each verdict with the intended use", async () => {
    const provider = fakeProvider(providerTrack());
    const view = await searchMusic(
      { providerId: "audius", query: { q: "cinematic", limit: 5 }, intendedUse: "editorial" },
      { provider },
    );
    expect(provider.searchCalls).toBe(1);
    expect(view.intendedUse).toBe("editorial");
    expect(view.tracks[0].verdict.permitted).toBe(false);
  });

  test("an unwired provider is a 503 naming its env vars, never an empty list", async () => {
    let caught: unknown = null;
    try {
      await searchMusic({ providerId: "epidemic", query: { q: "x", limit: 5 }, intendedUse: "commercial" }, {});
    } catch (err) {
      caught = err;
    }
    expect((caught as ApiError).status).toBe(503);
    expect((caught as ApiError).message).toContain("EPIDEMIC_API_KEY");
  });
});
