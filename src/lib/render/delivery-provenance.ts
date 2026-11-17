/**
 * WHAT A DELIVERED FILE MAY SAY ABOUT ITSELF (Phase 8, block 7b).
 *
 * The delivered container of a real render is NOT stamped synthetic — it is not
 * synthetic — and it is not stamped with anything the rows cannot support. Its
 * title is the project's title. Its comment is generated HERE, from the scenes'
 * own provenance rows, so the file carries the credit its sources require and
 * nothing else.
 *
 * Two rules this file exists to hold:
 *   1. every provider, id, author, page and licence named in the comment was
 *      read from a row — a scene with no provenance row makes the comment say
 *      so instead of being left out;
 *   2. the comment states what the file does NOT contain (narration, music,
 *      subtitles, screening), because a delivered video's silence about those is
 *      easily read as a claim that they are in it.
 */
import type { ProjectFacts } from "./types";

export interface DeliverySourceLine {
  order: number;
  sceneId: string;
  provider: string | null;
  providerAssetId: string | null;
  author: string | null;
  pageUrl: string | null;
  licenseType: string | null;
  licenseSource: string | null;
  licenseUrl: string | null;
  attribution: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  /** True only when the row named a provider — a missing provider is not "Pixabay". */
  hasProvenance: boolean;
}

export interface DeliveryProvenance {
  /** The container `comment` value. Generated, never typed at a call site. */
  comment: string;
  sources: DeliverySourceLine[];
  /** Distinct providers named by the rows, in first-seen order. */
  providers: string[];
  /** Every scene had a provenance row (a provider on its asset). */
  everySceneHasProvenance: boolean;
  /** True only when the caller states a music bed was really mixed into this file. */
  musicMixed: boolean;
  /** What the file does not contain, in the record's own words. */
  absences: {
    narration: string;
    music: string;
    subtitles: string;
    screening: string;
    aiGeneration: string;
    audio: string;
    selection: string;
  };
}

/** One credit clause per scene, from the row's own fields. */
function creditFor(line: DeliverySourceLine): string {
  if (!line.hasProvenance) {
    return `scene #${line.order}: no provider is recorded on this scene's asset, so no credit is stated for it`;
  }
  const bits: string[] = [];
  bits.push(line.provider as string);
  if (line.providerAssetId) bits.push(`id ${line.providerAssetId}`);
  bits.push(line.author ? `by ${line.author}` : "author not recorded on the row");
  const head = bits.join(" ");
  const tail: string[] = [];
  if (line.pageUrl) tail.push(line.pageUrl);
  if (line.licenseType) {
    tail.push(
      `licence ${line.licenseType}${line.licenseSource ? ` per ${line.licenseSource}` : ""}${line.licenseUrl ? ` (${line.licenseUrl})` : ""}`,
    );
  } else {
    tail.push("licence not recorded on the row");
  }
  if (line.purchasedAt || line.expiresAt) {
    tail.push(`purchase ${line.purchasedAt ?? "not stated"}, expiry ${line.expiresAt ?? "not stated"}`);
  } else {
    tail.push("no purchase and no expiry stated by the provider");
  }
  return `scene #${line.order}: ${head} — ${tail.join("; ")}`;
}

export function deliveryProvenance(facts: ProjectFacts, musicMixed = false): DeliveryProvenance {
  const sources: DeliverySourceLine[] = facts.scenes.map((s) => {
    const src = s.source ?? null;
    return {
      order: s.order,
      sceneId: s.id,
      provider: src?.provider ?? null,
      providerAssetId: src?.providerAssetId ?? null,
      author: src?.author ?? null,
      pageUrl: src?.pageUrl ?? null,
      licenseType: src?.licenseType ?? null,
      licenseSource: src?.licenseSource ?? null,
      licenseUrl: src?.licenseUrl ?? null,
      attribution: src?.attribution ?? null,
      purchasedAt: src?.purchasedAt ?? null,
      expiresAt: src?.expiresAt ?? null,
      hasProvenance: Boolean(src?.provider),
    };
  });

  const providers: string[] = [];
  for (const s of sources) {
    if (s.provider && !providers.includes(s.provider)) providers.push(s.provider);
  }

  /**
   * THE MUSIC CLAUSE (BLOCK M2). `musicMixed` is passed by the mux stage from
   * what the pipeline actually did — a fetched bed AND a stored verdict that
   * permits it — so the container never claims music it does not carry, and
   * never denies music it does. A CC BY / BY-SA licence requires attribution,
   * so when a track is mixed the credit is written here, with the plain
   * statement that the licence claim is the uploader's and unverified.
   */
  const music = facts.music;
  const musicSentence =
    musicMixed && music
      ? `Music: "${music.title}"${music.artist ? ` by ${music.artist}` : ""}` +
        `${music.artistHandle ? ` (@${music.artistHandle})` : ""}, ${music.provider} track ${music.providerTrackId}` +
        `${music.permalink ? ` (${music.permalink})` : ""}, licence stated by the uploader: ${music.licenceText ?? "none"}. ` +
        `The licence claim is the uploader's and has not been independently verified, and a licence record is not a clearance.`
      : "No music or sound effects: nothing was mixed from a music or SFX provider.";

  const absences = {
    narration: "No narration: no voice provider produced a voiceover for this file, so it carries none.",
    music: musicSentence,
    subtitles: "No subtitles: no subtitle cue was burned in, and no timed-text track is muxed.",
    screening: "No screening or clearance was performed on this file or its sources; a licence record is not a clearance.",
    aiGeneration:
      "Not AI-generated: the picture is stock footage as the providers served it, edited by this pipeline; no image or video model produced any frame.",
    /**
     * "Audio" alone would be ambiguous: the clips are stock video and some of
     * them carry their own sound. So the sentence says which audio this file can
     * contain, rather than leaving a reader to assume a mix happened.
     */
    audio:
      musicMixed && music
        ? "Audio: the source clips' own audio, mixed with the music track named above at the project's music level, " +
          "re-encoded to AAC at the delivery preset's layout. No narration and no sound effect was mixed or generated " +
          "for this file."
        : "Audio: the only sound this file can contain is the source clips' own audio, re-encoded to AAC at the " +
          "delivery preset's layout; a clip served without an audio track contributes silence, and nothing was mixed " +
          "or generated for this file.",
    /**
     * HOW THE CLIPS WERE CHOSEN. This is the gap a reader will look for, so the
     * file says it in its own sentence instead of letting the credits imply that
     * each clip illustrates its scene.
     */
    selection:
      "How the clips were chosen: each scene's clip was selected by a keyword search of a stock-footage provider " +
      "(the query and the provider's asset id are recorded per scene); the clips are NOT commissioned, directed or " +
      "model-matched illustrations of the narration, and a clip may show something related by keyword rather than " +
      "the exact subject a scene describes.",
  };

  const header =
    absences.aiGeneration + (providers.length > 0 ? ` Sources: ${providers.join(", ")}.` : " No provider is recorded on any scene's asset.");
  const comment = [
    header,
    ...sources.map(creditFor),
    absences.selection,
    absences.audio,
    absences.narration,
    absences.music,
    absences.subtitles,
    absences.screening,
  ].join(" ");

  return {
    comment,
    sources,
    providers,
    everySceneHasProvenance: sources.every((s) => s.hasProvenance),
    musicMixed: musicMixed && music !== null,
    absences,
  };
}
