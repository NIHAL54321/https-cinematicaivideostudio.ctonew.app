/**
 * Phase 7 Block 1 — ASSET LICENCE REPORT DATA.
 *
 * The single most dangerous assumption a publishing tool can make is that an
 * asset with no licence record is fine. Here it is not fine and not false:
 *
 *   - an asset with NO LicensingMetadata row is `unknown_unverified`, every
 *     licence field is empty-with-reason, and `attributionRequired` is EMPTY —
 *     not `false`. `false` would be an assertion this app cannot support.
 *   - an asset WITH a row has each column copied, and a null column is reported
 *     empty-with-reason naming the column, never defaulted to a licence type.
 *
 * This module derives DATA. It performs no legal assessment, and it says so in
 * the report itself (P7-4 owns the surface, and the content-safety screening).
 */
import { derived, emptyNoInput, type Field, type SourceRef } from "./provenance";
import type { PublishingAssetRow, PublishingLicensingRow, PublishingSource } from "./types";

export interface AssetLicenceEntry {
  assetId: string;
  name: string;
  kind: string;
  status: string;
  /** "verified_row" = a LicensingMetadata row was read; "unknown_unverified" = none exists. */
  verification: "verified_row" | "unknown_unverified";
  licensingRowId: string | null;
  provider: Field<string>;
  licenceType: Field<string>;
  attributionRequired: Field<boolean>;
  attributionText: Field<string>;
  licenceUrl: Field<string>;
  purchasedAt: Field<string>;
  expiresAt: Field<string>;
  expired: Field<boolean>;
  /**
   * P7-6: the asset's own ORIGIN row, read separately from its licence row. A
   * provider is recorded here because a row says so — never because the asset's
   * name or kind suggests one.
   */
  originTable: Field<string>;
  originProvider: Field<string>;
  originModel: Field<string>;
  externalAssetId: Field<string>;
  sourcePageUrl: Field<string>;
  /** What this asset's licence record does NOT tell you, in this app's own words. */
  whatThisDoesNotTellYou: string[];
  notes: string[];
}

export interface AssetLicenceReport {
  kind: "asset_licences";
  rule: "R-LIC-ROW";
  attributionRule: "R-LIC-ATTR";
  expiryRule: "R-LIC-EXPIRY";
  unknownRule: "R-LIC-UNKNOWN";
  evaluatedAt: string;
  entries: AssetLicenceEntry[];
  counts: {
    assets: number;
    verifiedRow: number;
    unknownUnverified: number;
    attributionRequired: number;
    expired: number;
  };
  /**
   * P7-6: how many assets carry each kind of origin row. `none` is the count of
   * assets with no origin row at all — a real state, reported rather than dropped.
   */
  originCounts: {
    assets: number;
    stock: number;
    generatedImage: number;
    generatedVideo: number;
    voiceover: number;
    none: number;
  };
  /** What an asset licence record does not tell you, said once for the whole report. */
  whatThisDoesNotTellYou: string[];
  /** What this report is not. Stated on the data, so no consumer can upgrade it. */
  statement: string;
  notLegalClearance: true;
  notes: string[];
}

const STATEMENT =
  "This is licence DATA read from this project's own Asset and LicensingMetadata rows. It is not legal clearance, it is not a permission, and it is not advice: " +
  "an asset whose licence is unknown is reported as unknown rather than assumed usable, and nothing here authorises publication of any asset.";

function iso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rowRef(kind: SourceRef["kind"], id: string, path: string): SourceRef {
  return { kind, id, path };
}

/**
 * P7-6: THE ASSET'S OWN ORIGIN ROW, read separately from its licence row.
 *
 * Where an asset came from is a FACT ABOUT A ROW (StockAsset, GeneratedImage,
 * GeneratedVideo or Voiceover), never an inference from the asset's name or kind:
 * an asset called `pexels-city-night.mp4` with no stock row reports no provider,
 * and an asset with a stock row reports that row's provider.
 */
function originFields(
  asset: PublishingAssetRow,
): Pick<AssetLicenceEntry, "originTable" | "originProvider" | "originModel" | "externalAssetId" | "sourcePageUrl"> {
  const origin = asset.origin ?? null;
  const ref = (path: string): SourceRef[] => [{ kind: "asset", id: asset.id, path }];
  if (!origin) {
    const reason = `Asset row ${asset.id} has no stock, generation or voiceover row, so this app holds no provider record for it.`;
    const requires = [
      "a StockAsset, GeneratedImage, GeneratedVideo or Voiceover row for this asset",
    ];
    return {
      originTable: emptyNoInput(reason, requires),
      originProvider: emptyNoInput(`${reason} A provider is not inferred from the asset's name or kind.`, requires),
      originModel: emptyNoInput(reason, requires),
      externalAssetId: emptyNoInput(reason, requires),
      sourcePageUrl: emptyNoInput(reason, requires),
    };
  }
  const path = origin.table;
  const value = (column: string, raw: string | null, label: string): Field<string> => {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed
      ? derived(trimmed, "R-LIC-ORIGIN", ref(`${path}.${column}`), {
          textOrigin: "source_verbatim",
          note: `${label} read from ${path}.${column} on row ${origin.id}.`,
        })
      : emptyNoInput(`${path} row ${origin.id} holds no ${column} for asset row ${asset.id}.`, [
          `${path}.${column} on this asset's origin row`,
        ]);
  };
  return {
    originTable: derived(origin.table, "R-LIC-ORIGIN", ref(path), {
      textOrigin: "rule_authored",
      note: `The origin row that exists for this asset, read from the schema's own relation (${origin.id}).`,
    }),
    originProvider: value("provider", origin.provider, "Provider"),
    originModel: value("model", origin.model, "Model"),
    externalAssetId: value("externalId", origin.externalId, "The provider's own asset id"),
    sourcePageUrl: value("pageUrl", origin.pageUrl, "The provider's page for this asset"),
  };
}

/** What one asset's licence record does not tell you. Plain sentences, no hedging. */
function licenceLimits(asset: PublishingAssetRow): string[] {
  const limits = [
    "It does not carry the licence's terms: this app stores a type, a source and a URL, not the text of any licence.",
    "It does not tell you whether the licence is still in force: only the stored expiry date is compared with the build time, and this app cannot read the licence a provider publishes today.",
    "It does not tell you whether this asset may be published on a particular platform: a licence and a platform's own terms are two different things.",
    "It does not tell you whether the asset is the licensor's to license, or whether a model that produced it was trained on material that could not be licensed.",
  ];
  if (!asset.licensing) {
    limits.unshift(
      "There is no licence record for this asset at all, so it tells you nothing: the asset is unknown and unverified, and this app has no basis to say it may be used.",
    );
  }
  return limits;
}

/** The licence fields of one asset, from its row or from the absence of one. */
function licenceFields(
  asset: PublishingAssetRow,
  nowMs: number,
): Pick<
  AssetLicenceEntry,
  | "provider"
  | "licenceType"
  | "attributionRequired"
  | "attributionText"
  | "licenceUrl"
  | "purchasedAt"
  | "expiresAt"
  | "expired"
  | "notes"
> {
  const notes: string[] = [];
  const row: PublishingLicensingRow | null = asset.licensing;

  if (!row) {
    // The asset's own stored NAME is deliberately not interpolated into this
    // sentence: a file called `viral-hook-final.mp4` must not make a project
    // unbuildable, and no app-authored sentence carries the project's characters
    // (see ./quotation). The asset is named by its row id, which this app
    // generates; its own name is rendered on the surface as a declared value.
    const reason = `Asset row ${asset.id} has no LicensingMetadata row, so its licence is unknown and unverified.`;
    const requires = [`a LicensingMetadata row for asset ${asset.id}`];
    notes.push(
      "No licence row exists for this asset. Every licence field below is empty because the app holds no value for it — none of them is false, none is defaulted, and this asset must not be treated as cleared.",
    );
    return {
      provider: emptyNoInput(reason, requires),
      licenceType: emptyNoInput(reason, requires),
      attributionRequired: emptyNoInput(
        `${reason} Whether attribution is required is therefore unknown — NOT false.`,
        requires,
        { note: "The rule R-LIC-ATTR only applies to an asset that has a row; with no row there is nothing to apply it to." },
      ),
      attributionText: emptyNoInput(reason, requires),
      licenceUrl: emptyNoInput(reason, requires),
      purchasedAt: emptyNoInput(reason, requires),
      expiresAt: emptyNoInput(reason, requires),
      expired: emptyNoInput(reason, requires),
      notes,
    };
  }

  const ref = (path: string): SourceRef[] => [rowRef("licensing", row.id, path)];
  const value = (column: string, raw: string | null, label: string): Field<string> => {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed
      ? derived(trimmed, "R-LIC-ROW", ref(column), {
          textOrigin: "source_verbatim",
          note: `${label} read from LicensingMetadata.${column} on row ${row.id}.`,
        })
      : emptyNoInput(
          `LicensingMetadata row ${row.id} holds no ${column} for asset row ${asset.id}.`,
          [`LicensingMetadata.${column} on this asset's row`],
        );
  };

  const attribution = row.attribution?.trim() ?? "";
  const attributionRequired: Field<boolean> = derived(attribution.length > 0, "R-LIC-ATTR", ref("attribution"), {
    note:
      attribution.length > 0
        ? "True because the row stores a non-empty attribution string. This is this app's own rule over the column, stated so a consumer can disagree with it — it is not legal advice."
        : "False because the row exists and its attribution column holds no text. A row that exists with no attribution text is a different state from an asset with no row at all.",
  });

  const expiresAt = iso(row.expiresAt);
  const expired: Field<boolean> = expiresAt
    ? derived(new Date(expiresAt).getTime() < nowMs, "R-LIC-EXPIRY", ref("expiresAt"), {
        note: `Compared with the package's derivation time. The row's expiry is ${expiresAt}.`,
      })
    : emptyNoInput(
        `LicensingMetadata row ${row.id} holds no expiresAt, so whether this licence has expired cannot be determined from the record.`,
        ["LicensingMetadata.expiresAt on this asset's row"],
        { note: "A null expiry does not mean the licence never expires; it means the record does not say." },
      );

  if (expiresAt && new Date(expiresAt).getTime() < nowMs) {
    notes.push(`The stored expiry (${expiresAt}) is in the past at derivation time.`);
  }

  return {
    provider: value("source", row.source, "Licence provider/source"),
    licenceType: value("licenseType", row.licenseType, "Licence type"),
    attributionRequired,
    attributionText: value("attribution", row.attribution, "Attribution text"),
    licenceUrl: value("licenseUrl", row.licenseUrl, "Licence URL"),
    purchasedAt: value("purchasedAt", iso(row.purchasedAt), "Purchase date"),
    expiresAt: value("expiresAt", expiresAt, "Expiry date"),
    expired,
    notes,
  };
}

export function buildAssetLicenceReport(source: PublishingSource, derivedAt: Date): AssetLicenceReport {
  const nowMs = derivedAt.getTime();
  const ordered = [...source.assets].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );

  const entries: AssetLicenceEntry[] = ordered.map((asset) => ({
    assetId: asset.id,
    name: asset.name,
    kind: asset.kind,
    status: asset.status,
    verification: asset.licensing ? "verified_row" : "unknown_unverified",
    licensingRowId: asset.licensing?.id ?? null,
    ...licenceFields(asset, nowMs),
    ...originFields(asset),
    whatThisDoesNotTellYou: licenceLimits(asset),
  }));

  const notes: string[] = [];
  const unknown = entries.filter((e) => e.verification === "unknown_unverified").length;
  if (ordered.length === 0) {
    notes.push("This project has no assets, so the licence report has nothing to report on.");
  } else if (unknown > 0) {
    notes.push(
      `${unknown} of ${ordered.length} asset(s) have no LicensingMetadata row and are reported unknown/unverified. This app does not treat a missing licence record as permission.`,
    );
  } else {
    notes.push(`All ${ordered.length} asset(s) have a LicensingMetadata row.`);
  }

  return {
    kind: "asset_licences",
    rule: "R-LIC-ROW",
    attributionRule: "R-LIC-ATTR",
    expiryRule: "R-LIC-EXPIRY",
    unknownRule: "R-LIC-UNKNOWN",
    evaluatedAt: derivedAt.toISOString(),
    entries,
    counts: {
      assets: entries.length,
      verifiedRow: entries.length - unknown,
      unknownUnverified: unknown,
      attributionRequired: entries.filter((e) => e.attributionRequired.state === "derived" && e.attributionRequired.value).length,
      expired: entries.filter((e) => e.expired.state === "derived" && e.expired.value).length,
    },
    originCounts: {
      assets: entries.length,
      stock: entries.filter((e) => ordered.find((a) => a.id === e.assetId)?.origin?.table === "stock_asset").length,
      generatedImage: entries.filter((e) => ordered.find((a) => a.id === e.assetId)?.origin?.table === "generated_image").length,
      generatedVideo: entries.filter((e) => ordered.find((a) => a.id === e.assetId)?.origin?.table === "generated_video").length,
      voiceover: entries.filter((e) => ordered.find((a) => a.id === e.assetId)?.origin?.table === "voiceover").length,
      none: entries.filter((e) => !ordered.find((a) => a.id === e.assetId)?.origin).length,
    },
    whatThisDoesNotTellYou: [
      "A licence record is not the licence. This app stores a type, a source, an attribution string, a URL and two dates; it does not store the licence's terms and it cannot read the terms a provider publishes today.",
      "A licence record does not tell you that an asset may be published on a platform: a licence and a platform's own rules are separate, and neither implies the other.",
      "A licence record does not tell you that the licensor was entitled to license the asset, or that nothing in it was itself reproduced from someone else's work.",
      "A licence record does not tell you whether the asset is still covered: only the stored expiry date is compared with the moment this package was built.",
      "A licence record does not make an asset lawful to publish. Nothing in this report is legal clearance, and this app has not approved any asset for publication.",
    ],
    statement: STATEMENT,
    notLegalClearance: true,
    notes,
  };
}
