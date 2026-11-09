/**
 * The Media Library's stock-provider banner, as a pure derivation.
 *
 * ── What went wrong (Phase 8 truthful-surfaces block, 2026-11-09) ───────────
 * The banner fired `GET /api/media?q=cinematic landscape` — no `mediaType` — so
 * the route fell through to its IMAGE default and answered `not_connected` with
 * the image providers' env names, while the same server answered a real Pixabay
 * VIDEO search with 200 and real candidates, and the library listed Pixabay
 * video assets directly underneath the banner. The banner asked a different
 * question from the one a search asks, then stated the answer as a fact about
 * the whole library.
 *
 * ── The rule now ───────────────────────────────────────────────────────────
 * The banner is derived from `/api/media/status`, which reports the SAME
 * `stockProviderAvailability()` the search route uses to pick providers, plus a
 * live probe search so "available" is observed rather than assumed.
 *
 *   - a provider with its key set is never described as "not connected";
 *   - a provider that is configured but did not answer is described as exactly
 *     that, with the provider's own message, not as "not connected";
 *   - with no key at all, the banner says so and names the env vars;
 *   - the media type each provider can search is named, because a Pixabay video
 *     key does not make image search work.
 *
 * Pure on purpose: both directions (rows exist / rows absent) are unit-tested.
 */

export interface BannerProvider {
  id: string;
  name: string;
  mediaTypes: string[];
}

export interface BannerMissingProvider {
  id: string;
  name: string;
  /** The media types the missing provider would have served. */
  mediaTypes: string[];
  requiredEnv: string[];
}

export interface BannerProbe {
  mediaType: string;
  /** "ok" when at least one configured provider answered the live probe. */
  status: string;
  candidates: number;
  /** The provider's own failure message, when it did not answer. */
  message?: string | null;
  /** Which provider ids answered the probe. */
  answeredBy?: string[];
}

export interface StockBannerInput {
  connected: BannerProvider[];
  missing: BannerMissingProvider[];
  liveProbe: BannerProbe | null;
}

export interface StockBannerView {
  show: boolean;
  tone: "ok" | "warn";
  title: string;
  body: string;
  /** Env var NAMES only — never values. */
  chips: string[];
}

function withTypes(p: BannerProvider): string {
  const types = p.mediaTypes.length ? ` (${p.mediaTypes.join(", ")})` : "";
  return `${p.name}${types}`;
}

function missingChips(missing: BannerMissingProvider[]): string[] {
  return [...new Set(missing.flatMap((m) => m.requiredEnv))];
}

export function stockBannerView(input: StockBannerInput): StockBannerView {
  const { connected, missing, liveProbe } = input;
  const chips = missingChips(missing);

  /* ---- Nothing configured: the honest absence sentence -------------------- */
  if (connected.length === 0) {
    const names = missing.map((m) => m.name).join(", ");
    const envs = chips.length ? chips.join(", ") : "a provider API key";
    return {
      show: true,
      tone: "warn",
      title: "Stock Provider Not Connected.",
      body:
        `No stock provider is configured on this server: ${names || "no provider adapter is registered"}. ` +
        `Stock search needs ${envs} set server-side. No search results are fabricated.`,
      chips,
    };
  }

  const connectedNames = connected.map(withTypes).join(", ");
  const missingSentence = missing.length
    ? ` Not connected: ${missing
        .map((m) => `${m.name}${m.requiredEnv.length ? ` (${m.requiredEnv.join(", ")})` : ""}`)
        .join(", ")} — ${
        [...new Set(missing.flatMap((m) => m.mediaTypes))].join("/") || "that"
      } search needs one of those.`
    : "";

  /* ---- Configured, and a live search just answered ------------------------ */
  if (liveProbe && liveProbe.status === "ok") {
    const n = liveProbe.candidates;
    const answered = liveProbe.answeredBy?.length
      ? ` (answered by ${liveProbe.answeredBy.join(", ")})`
      : "";
    return {
      show: true,
      tone: "ok",
      title: `Stock providers connected: ${connectedNames}.`,
      body:
        `A live ${liveProbe.mediaType} search just now returned ${n} candidate${n === 1 ? "" : "s"}${answered}.` +
        missingSentence,
      chips,
    };
  }

  /* ---- Configured, but nothing answered: say that, with the provider's word */
  if (liveProbe) {
    return {
      show: true,
      tone: "warn",
      title: `${connectedNames} configured, but no provider answered.`,
      body:
        `The server holds the key for ${connectedNames}, so a search will be attempted — but a live ` +
        `${liveProbe.mediaType} probe just now returned "${liveProbe.status}"` +
        `${liveProbe.message ? `: ${liveProbe.message}` : ""}. Nothing is fabricated to fill the gap.` +
        missingSentence,
      chips,
    };
  }

  /* ---- Configured, probe not attempted (no media type in common) ---------- */
  return {
    show: true,
    tone: "warn",
    title: `Stock providers configured: ${connectedNames}.`,
    body:
      `The server holds the key for ${connectedNames}, but no live probe was run for a media type it ` +
      `supports, so this banner does not claim a search works.${missingSentence}`,
    chips,
  };
}
