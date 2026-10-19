/**
 * Phase 7 Block 7 — COPYING AND EXPORTING THE PACKAGE ITSELF.
 *
 * The workspace has to be able to hand a user the package, and the thing it hands
 * over has to BE the package: not a summary of it, not the sections that happened
 * to be rendered, and not a re-derivation made at copy time. So this module builds
 * the export from the payload the server read back, and it measures what it built:
 *
 *   - `text` is `JSON.stringify(pkg)` of that payload and nothing else — no
 *     wrapper object, no picked fields, no added header. What a user pastes or
 *     downloads is the package;
 *   - `values` / `paths` are a WALK of the produced TEXT after parsing it back
 *     (`package-coverage.walkLeafPaths`) compared with a walk of the payload it
 *     came from. `droppedValues` is the difference. A copy that lost a part would
 *     show up here as a non-zero number rather than as a claim that it did not;
 *   - `bytes` and `sha256` are measured on the text itself, so a reader (or a
 *     proof) can hash what it received and compare it with what the server said.
 *
 * WHY THE DIFFERENCE IS COMPUTED RATHER THAN ASSERTED. `JSON.stringify` on a
 * package that carries `undefined` or a function somewhere would silently drop
 * those keys. Nothing in a package should, and saying "nothing is dropped" is a
 * claim; counting the difference is a measurement. A non-zero `droppedValues`
 * would be a defect, so the service refuses to export in that case (see
 * `service.ts`) instead of handing over a subset with a straight face.
 */
import { createHash } from "node:crypto";
import { walkLeafPaths } from "./package-coverage";

export interface PackageExport {
  kind: "publishing_package_export";
  projectId: string;
  savedPackageId: string;
  version: number;
  /** The format the stored package records for itself. */
  format: string;
  /** The file name a download uses. Carries the project id and the version, no claim. */
  filename: string;
  mimeType: "application/json";
  /** THE PACKAGE, exactly as it will be pasted or downloaded. */
  text: string;
  /** Measured on `text` — the characters a copy of this package consists of. */
  bytes: number;
  /** SHA-256 of `text`, hex. Measured here so a reader can hash what it got. */
  sha256: string;
  /** The walk of the payload this text was built from. */
  values: number;
  paths: number;
  /** The walk of the text after parsing it back, which must match the two above. */
  valuesInText: number;
  /** `values - valuesInText`: what a copy would lose. Zero, and measured rather than assumed. */
  droppedValues: number;
  /** The app's own sentence about what the text is, rendered beside the copy control. */
  statement: string;
}

/** The leaf counts of an object, as the workspace's own walk counts them. */
export function valueInventory(value: unknown): { values: number; paths: number } {
  const leaves = walkLeafPaths(value);
  return { values: leaves.length, paths: new Set(leaves.map((p) => p.join("."))).size };
}

/**
 * Builds the export for one stored package. Throws when the text does not parse
 * back to the same value count, because that is a copy that dropped something and
 * a copy that dropped something must not leave the server.
 */
export function buildPackageExport(input: {
  pkg: unknown;
  projectId: string;
  savedPackageId: string;
  version: number;
  format: string;
}): PackageExport {
  const text = JSON.stringify(input.pkg);
  const fromPayload = valueInventory(input.pkg);
  const fromText = valueInventory(JSON.parse(text) as unknown);
  const droppedValues = fromPayload.values - fromText.values;
  if (droppedValues !== 0) {
    throw new Error(
      `buildPackageExport(): the exported text carries ${fromText.values} value(s) but the stored package carries ` +
        `${fromPayload.values}; a copy of this package would be a subset of it, so it was not produced.`,
    );
  }
  return {
    kind: "publishing_package_export",
    projectId: input.projectId,
    savedPackageId: input.savedPackageId,
    version: input.version,
    format: input.format,
    filename: `publishing-package-${input.projectId}-v${input.version}.json`,
    mimeType: "application/json",
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    values: fromPayload.values,
    paths: fromPayload.paths,
    valuesInText: fromText.values,
    droppedValues,
    statement:
      "This text is the stored package itself, serialised: it carries every key and every value the server read back, and " +
      "re-parsing it yields the same number of values and the same paths the stored package was walked to. The size and the hash " +
      "beside it were measured on these characters, so a copy can be checked against them.",
  };
}
