/**
 * GET /api/studio/proofs — the LABELLED synthetic proof read-out.
 *
 * This is the one surface that reads synthetic artefacts, and it reads them by
 * requiring the synthetic marking (the inverse of the download centre's rule).
 * It exists because the pipeline's real files are currently all encodes of a
 * source the encoder generated itself: they must be inspectable — with their
 * recorded sizes and digests, and whether their bytes are still on this machine —
 * without any of them being offered as a user's own file.
 */
import { apiError, requireApiUser } from "@/lib/api";
import { fmtBytes, downloadFilename } from "@/lib/downloads/centre";
import { PROOF_PROVENANCE } from "@/lib/downloads/resolve";
import { proofWhereForUser } from "@/lib/downloads/rule";
import { checkOnDisk } from "@/lib/downloads/verify";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireApiUser();
    const rows = await prisma.renderArtefact.findMany({
      where: proofWhereForUser(userId),
      include: {
        job: {
          select: {
            id: true,
            presetId: true,
            presetLabel: true,
            syntheticProof: true,
            syntheticSource: true,
            project: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
      take: 200,
    });

    const files = [];
    const sidecarRows = await prisma.renderArtefact.findMany({
      where: { ...proofWhereForUser(userId), kind: "checksum-sidecar" },
      orderBy: [{ createdAt: "asc" }],
      take: 200,
    });
    const sidecarByJob = new Map(sidecarRows.map((s) => [s.jobId, s]));
    for (const row of rows) {
      const disk = await checkOnDisk({ id: row.id, path: row.path, bytes: row.bytes, sha256: row.sha256 });
      const sidecar = sidecarByJob.get(row.jobId) ?? null;
      const sidecarDisk = sidecar
        ? await checkOnDisk({ id: sidecar.id, path: sidecar.path, bytes: sidecar.bytes, sha256: sidecar.sha256 })
        : null;
      const sidecarPresent = sidecar !== null && sidecarDisk !== null && sidecarDisk.present && sidecarDisk.sizeMatches;
      files.push({
        artefactId: row.id,
        jobId: row.jobId,
        jobPresetId: row.job.presetId,
        jobPresetLabel: row.job.presetLabel,
        projectTitle: row.job.project.title,
        kind: row.kind,
        path: row.path,
        recordedBytes: row.bytes,
        recordedSize: fmtBytes(row.bytes),
        recordedSha256: row.sha256,
        createdAt: row.createdAt.toISOString(),
        presentOnDisk: disk.present,
        diskBytes: disk.diskBytes,
        sizeMatchesRecord: disk.sizeMatches,
        state: disk.present ? (disk.sizeMatches ? "present" : "altered") : "gone",
        synthetic: true,
        provenance: PROOF_PROVENANCE,
        filename: downloadFilename({
          projectTitle: row.job.project.title,
          presetId: row.job.presetId,
          kind: row.kind,
          path: row.path,
          synthetic: true,
        }),
        href: `/api/studio/proofs/${row.id}`,
        sidecarHref: sidecarPresent ? `/api/studio/proofs/${sidecar!.id}/sidecar` : null,
        sidecarArtefactId: sidecar?.id ?? null,
        sidecarBytes: sidecar?.bytes ?? null,
        sidecarPresent,
      });
    }

    return Response.json(
      {
        synthetic: true,
        statement:
          "Every file here is a SYNTHETIC ENCODER PROOF: the pipeline's own encode stage ran on a source the " +
          "encoder generated itself (testsrc2 pattern, 440 Hz tone) at a declared size, cadence and length. " +
          "None of these is a project's video, a customer's video, or a delivered master, and none appears in " +
          "any user's download list.",
        count: files.length,
        presentCount: files.filter((f) => f.state === "present").length,
        files,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    return apiError(err);
  }
}
