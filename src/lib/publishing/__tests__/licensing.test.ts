import { describe, expect, test } from "bun:test";
import { buildAssetLicenceReport } from "../licensing";
import { richSource, NOW } from "./fixtures";
import type { PublishingAssetRow } from "../types";

function report(assets: PublishingAssetRow[]) {
  const source = richSource();
  source.assets = assets;
  return buildAssetLicenceReport(source, NOW);
}

const WITH_ROW: PublishingAssetRow = {
  id: "as_1",
  name: "Stock clip",
  kind: "STOCK",
  status: "READY",
  mimeType: "video/mp4",
  createdAt: "2026-10-01T00:00:00.000Z",
  licensing: {
    id: "lic_1",
    licenseType: "ROYALTY_FREE",
    source: "Pexels",
    attribution: "Footage by A. Operator",
    licenseUrl: "https://www.pexels.com/license/",
    purchasedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
};

const NO_ROW: PublishingAssetRow = {
  id: "as_2",
  name: "Old map scan",
  kind: "IMAGE",
  status: "READY",
  mimeType: "image/png",
  createdAt: "2026-10-02T00:00:00.000Z",
  licensing: null,
};

describe("asset licence report — a missing row is unknown, never 'fine'", () => {
  test("an asset with a row has every column copied, with the row id as its source", () => {
    const plan = report([WITH_ROW]);
    const entry = plan.entries[0];
    expect(entry.verification).toBe("verified_row");
    expect(entry.licensingRowId).toBe("lic_1");
    expect(entry.provider.state === "derived" && entry.provider.value).toBe("Pexels");
    expect(entry.licenceType.state === "derived" && entry.licenceType.value).toBe("ROYALTY_FREE");
    expect(entry.attributionText.state === "derived" && entry.attributionText.value).toBe("Footage by A. Operator");
    expect(entry.licenceUrl.state === "derived" && entry.licenceUrl.value).toBe("https://www.pexels.com/license/");
    expect(entry.purchasedAt.state === "derived" && entry.purchasedAt.value).toBe("2026-09-01T00:00:00.000Z");
    expect(entry.expiresAt.state === "derived" && entry.expiresAt.value).toBe("2027-01-01T00:00:00.000Z");
    expect(entry.provider.sources).toEqual([{ kind: "licensing", id: "lic_1", path: "source" }]);
    expect(plan.counts).toEqual({ assets: 1, verifiedRow: 1, unknownUnverified: 0, attributionRequired: 1, expired: 0 });
  });

  test("attribution is required only because a non-empty attribution string is stored", () => {
    const withAttribution = report([WITH_ROW]).entries[0];
    expect(withAttribution.attributionRequired.state === "derived" && withAttribution.attributionRequired.value).toBe(true);

    const without = report([
      { ...WITH_ROW, licensing: { ...WITH_ROW.licensing!, attribution: null } },
    ]).entries[0];
    expect(without.attributionRequired.state === "derived" && without.attributionRequired.value).toBe(false);
    expect(without.attributionText.state).toBe("empty_no_input");
  });

  test("NO ROW: every licence field is empty-with-reason and attribution is EMPTY, not false", () => {
    const plan = report([NO_ROW]);
    const entry = plan.entries[0];
    expect(entry.verification).toBe("unknown_unverified");
    expect(entry.licensingRowId).toBeNull();
    for (const field of [
      entry.provider,
      entry.licenceType,
      entry.attributionText,
      entry.licenceUrl,
      entry.purchasedAt,
      entry.expiresAt,
      entry.expired,
      entry.attributionRequired,
    ]) {
      expect(field.state).toBe("empty_no_input");
      expect(field.value).toBeNull();
    }
    expect(entry.attributionRequired.state === "empty_no_input" && entry.attributionRequired.reason).toContain("NOT false");
    expect(entry.attributionRequired.requires).toEqual(["a LicensingMetadata row for asset as_2"]);
    expect(entry.notes.join(" ")).toContain("must not be treated as cleared");
    expect(plan.counts.unknownUnverified).toBe(1);
    // Critically: nothing anywhere asserts this asset is acceptable.
    expect(plan.counts.attributionRequired).toBe(0);
    expect(JSON.stringify(entry)).not.toContain('"value":true');
  });

  test("the licence type is never defaulted — a null column is empty, not GENERATED", () => {
    const entry = report([{ ...WITH_ROW, licensing: { ...WITH_ROW.licensing!, licenseType: "" } }]).entries[0];
    expect(entry.licenceType.state).toBe("empty_no_input");
    if (entry.licenceType.state === "empty_no_input") {
      expect(entry.licenceType.requires).toEqual(["LicensingMetadata.licenseType on this asset's row"]);
    }
  });

  test("expiry is compared with the derivation time, and a null expiry is unknown", () => {
    const inThePast = report([{ ...WITH_ROW, licensing: { ...WITH_ROW.licensing!, expiresAt: "2026-01-01T00:00:00.000Z" } }]);
    expect(inThePast.entries[0].expired.state === "derived" && inThePast.entries[0].expired.value).toBe(true);
    expect(inThePast.counts.expired).toBe(1);

    const unknown = report([{ ...WITH_ROW, licensing: { ...WITH_ROW.licensing!, expiresAt: null } }]).entries[0];
    expect(unknown.expired.state).toBe("empty_no_input");
    if (unknown.expired.state === "empty_no_input") expect(unknown.expired.note).toContain("does not mean the licence never expires");
  });

  test("the report states on its own data that it is not legal clearance", () => {
    const plan = report([WITH_ROW, NO_ROW]);
    expect(plan.notLegalClearance).toBe(true);
    expect(plan.statement).toContain("not legal clearance");
    expect(plan.statement).toContain("not advice");
    expect(plan.notes.join(" ")).toContain("does not treat a missing licence record as permission");
  });

  test("mixed assets: counts add up and order is deterministic", () => {
    const plan = report([NO_ROW, WITH_ROW]);
    expect(plan.entries.map((e) => e.assetId)).toEqual(["as_1", "as_2"]);
    expect(plan.counts.assets).toBe(2);
    expect(plan.counts.verifiedRow + plan.counts.unknownUnverified).toBe(2);
  });

  test("a project with no assets says so rather than reporting an empty all-clear", () => {
    const plan = report([]);
    expect(plan.entries).toEqual([]);
    expect(plan.counts.assets).toBe(0);
    expect(plan.notes.join(" ")).toContain("no assets, so the licence report has nothing to report on");
  });
});
