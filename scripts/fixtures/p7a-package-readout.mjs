#!/usr/bin/env node
/**
 * p7a-package-readout.mjs — turn a captured publishing-package response into the
 * compact read-out the P7-7a proof actually quotes.
 *
 *   node scripts/fixtures/p7a-package-readout.mjs /tmp/p7a_package.json
 *
 * It prints a short report and writes `<input>.readout.json` beside the capture.
 * It asserts nothing and changes nothing: every number in the read-out is read
 * out of the package's own JSON, so a read-out that says "0 flags" means the
 * package held zero flags — not that a probe failed to find them.
 *
 * Exits non-zero only when the file cannot be parsed or has no `package` object.
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: p7a-package-readout.mjs <captured-package.json>");
  process.exit(2);
}

const response = JSON.parse(readFileSync(file, "utf8"));
const pkg = response.package ?? response;
if (!pkg || typeof pkg !== "object" || !pkg.format) {
  console.error("this file does not hold a publishing package (no format key)");
  process.exit(1);
}

const val = (f) => (f && typeof f === "object" && "state" in f ? f.value : f);

const flags = [];
for (const area of pkg.screening?.areas ?? []) {
  for (const flag of area.flags ?? []) {
    flags.push({
      area: area.area,
      rule: flag.rule,
      probe: flag.probeLabel,
      rowKind: flag.rowKind,
      rowId: flag.rowId,
      field: flag.field,
      span: flag.span,
      matched: val(flag.matched),
      whyItFired: val(flag.whyItFired),
    });
  }
}

const areas = (pkg.screening?.areas ?? []).map((a) => ({
  area: a.area,
  label: a.label,
  flags: (a.flags ?? []).length,
  status: a.status,
  statusLabel: a.statusLabel,
  capabilityState: a.capability?.state ?? null,
  capabilityId: a.capability?.capabilityId ?? null,
}));

const licences = (pkg.assetLicences?.entries ?? []).map((e) => ({
  assetId: e.assetId,
  name: val(e.name),
  kind: e.kind,
  verification: e.verification,
  licensingRowId: e.licensingRowId,
  licenceType: val(e.licenceType),
  attributionRequired: val(e.attributionRequired),
  attributionText: val(e.attributionText),
  licenceUrl: val(e.licenceUrl),
  originTable: val(e.originTable),
  originProvider: val(e.originProvider),
  externalAssetId: val(e.externalAssetId),
  sourcePageUrl: val(e.sourcePageUrl),
  reason: e.licenceType?.reason ?? e.provider?.reason ?? null,
}));

const checks = (pkg.quality?.checks ?? []).map((c) => ({
  id: c.id,
  status: c.state ?? c.status ?? c.result ?? null,
  weight: c.weight,
  measurement: val(c.measurement),
}));

const readout = {
  capturedFrom: file,
  capturedAt: new Date().toISOString(),
  format: pkg.format,
  kind: pkg.kind,
  block: pkg.block,
  projectId: pkg.projectId,
  projectTitle: val(pkg.projectTitle),
  derivedAt: pkg.derivedAt,
  sourceFingerprint: pkg.sourceFingerprint,
  screening: {
    areas,
    flagCount: flags.length,
    flags,
    notScreenedNoCapabilityAreas: areas.filter(
      (a) => a.capabilityState === "not_screened_no_capability",
    ).length,
    counts: pkg.screening?.counts ?? null,
    clearedForPublication: val(pkg.screening?.clearedForPublication),
    humanReviewRequired: val(pkg.screening?.humanReviewRequired),
  },
  assetLicences: {
    entries: licences,
    counts: pkg.assetLicences?.counts ?? null,
    originCounts: pkg.assetLicences?.originCounts ?? null,
  },
  quality: {
    counts: pkg.quality?.counts ?? null,
    score: pkg.quality?.score?.score ?? pkg.quality?.score ?? null,
    basis: pkg.quality?.score?.basis ?? null,
    checks,
  },
};

const out = `${file.replace(/\.json$/i, "")}.readout.json`;
writeFileSync(out, JSON.stringify(readout, null, 1));

const line = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);

console.log(`package            ${readout.format}  (${readout.kind}, block ${readout.block})`);
console.log(`project            ${readout.projectId}`);
console.log(`derivedAt          ${readout.derivedAt}`);
console.log(`fingerprint        ${readout.sourceFingerprint}`);
console.log("");
console.log(`screening flags    ${flags.length}`);
for (const f of flags) {
  const span = f.span ? `${f.span.start}–${f.span.end}` : "—";
  console.log(`  ${f.rule.padEnd(28)} ${String(f.rowKind).padEnd(9)} ${String(f.rowId).padEnd(28)} ${String(f.field).padEnd(10)} span ${span}  matched ${JSON.stringify(f.matched)}`);
}
console.log(`areas with "not screened — no capability"  ${readout.screening.notScreenedNoCapabilityAreas} of ${areas.length}`);
console.log("");
console.log("asset licences");
for (const e of licences) {
  console.log(`  ${e.assetId.padEnd(28)} ${String(e.verification).padEnd(18)} ${e.licenceType ?? "—"}  origin ${e.originTable ?? "—"} / ${e.originProvider ?? "—"}`);
  if (e.verification === "unknown_unverified" && e.reason) console.log(`      reason: ${e.reason}`);
}
console.log(`  counts: ${JSON.stringify(readout.assetLicences.counts)}`);
console.log("");
console.log("quality");
for (const c of checks) {
  const m = String(c.measurement ?? "");
  console.log(`  ${String(c.id).padEnd(20)} ${String(c.status).padEnd(13)} w${String(c.weight).padStart(2)}  ${m.slice(0, 110)}`);
}
console.log(`  counts: ${JSON.stringify(readout.quality.counts)}`);
if (readout.quality.score) {
  line("score", readout.quality.score.value ?? JSON.stringify(readout.quality.score));
  line("note", readout.quality.score.note ?? "");
}
console.log("");
console.log(`wrote ${out}`);
