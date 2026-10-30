import { Download, FileWarning, HardDriveDownload, Inbox } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtBytes, loadDownloadCentre, type DeliverableFile } from "@/lib/downloads/centre";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Downloads" };
export const dynamic = "force-dynamic";

/**
 * THE DOWNLOAD CENTRE (Phase 8, block 3).
 *
 * Every sentence on this page is derived from a row plus a `stat()` of the file
 * that row names — never from a template, a flag or a hope. There are four honest
 * states on this build and each one is rendered as itself:
 *
 *   present  — the bytes are on this machine at the recorded size, with a real
 *              download and a real digest sidecar beside it;
 *   gone     — the row records a file that a machine reset removed from /tmp; the
 *              recorded size and SHA-256 are still shown, and no link is offered;
 *   altered  — a file is at the recorded path but is not the recorded size, and
 *              it is not served in that state;
 *   awaiting — a project with no file at all, with the reason read from its own
 *              render job's stage rows (naming the missing input).
 *
 * A synthetic encoder proof is NEVER one of these rows: `rule.ts` keeps it out of
 * this query, out of this list and out of the download route. The labelled proof
 * read-out is a separate surface (`/api/studio/proofs`).
 */
export default async function DownloadsPage() {
  const session = await requireUser();
  const centre = await loadDownloadCentre({ userId: session.userId });

  const toneFor = (state: DeliverableFile["state"]) =>
    state === "present" ? ("ok" as const) : state === "altered" ? ("danger" as const) : ("accent" as const);
  const labelFor = (state: DeliverableFile["state"]) =>
    state === "present" ? "On this machine" : state === "altered" ? "Not the recorded file" : "Produced, file gone";

  const stats = [
    { label: "Files you can download", value: centre.counts.present, icon: HardDriveDownload },
    { label: "Produced, file gone", value: centre.counts.gone, icon: FileWarning },
    { label: "Projects awaiting a file", value: centre.counts.projectsAwaiting, icon: Inbox },
  ];

  return (
    <div>
      <PageHeader
        title="Downloads"
        description="Every file this account's render jobs have produced, with its size, its SHA-256 and a download that serves exactly those bytes. The digest and size are re-checked against the file before a download starts, and the download is refused — never silently corrected — if they differ. Render output lives in /tmp/cavs-render-output, which a machine reset wipes, so a row whose file is gone says so and offers no link in its place."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="glass-hover p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{s.label}</p>
              <s.icon size={16} strokeWidth={1.75} className="text-accent/80" />
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">{s.value}</p>
          </Card>
        ))}
      </div>

      {centre.emptyState ? (
        <Card className="mt-6 p-6">
          <h2 className="font-display text-lg font-semibold text-ink">{centre.emptyState.headline}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">{centre.emptyState.reason}</p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-faint">{centre.emptyState.note}</p>
          <p className="mt-4 text-xs text-ink-faint">
            {centre.counts.projectsAwaiting} project{centre.counts.projectsAwaiting === 1 ? "" : "s"} on this account
            {centre.counts.projectsAwaiting === 1 ? " has" : " have"} no produced file.
          </p>
        </Card>
      ) : null}

      {centre.files.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-display text-base font-semibold text-ink">Produced files</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-dim">
            {centre.counts.total} artefact row{centre.counts.total === 1 ? "" : "s"} for your projects:{" "}
            {centre.counts.present} present, {centre.counts.gone} whose file is gone, {centre.counts.altered} not at
            the recorded size. {fmtBytes(centre.counts.bytesPresent)} in total can be downloaded right now.
          </p>
          <ul className="mt-4 space-y-4">
            {centre.files.map((file) => (
              <li key={file.artefactId}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-semibold text-ink">{file.filename}</p>
                      <p className="mt-1 text-xs text-ink-faint">
                        {file.projectTitle} · {file.presetLabel} · {file.kindLabel}
                      </p>
                    </div>
                    <Badge tone={toneFor(file.state)}>{labelFor(file.state)}</Badge>
                  </div>

                  <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                        Recorded size
                      </dt>
                      <dd className="mt-0.5 text-ink-dim">{fmtBytes(file.recordedBytes)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                        Recorded SHA-256
                      </dt>
                      <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-dim">{file.recordedSha256}</dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-sm leading-relaxed text-ink-dim">{file.sentence}</p>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {file.state === "present" ? (
                      <a
                        href={file.href}
                        className="inline-flex items-center gap-2 rounded-xl border border-accent-line bg-accent-soft px-3 py-2 text-sm font-medium text-accent transition hover:text-accent-strong"
                      >
                        <Download size={15} strokeWidth={1.9} />
                        Download {fmtBytes(file.recordedBytes)}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-faint">
                        No download is offered for this row: the file it recorded is not on this machine.
                      </span>
                    )}
                    {file.sidecarHref ? (
                      <a href={file.sidecarHref} className="text-xs text-accent hover:text-accent-strong">
                        Digest sidecar ({fmtBytes(file.sidecarBytes)})
                      </a>
                    ) : file.sidecarState === "gone" ? (
                      <span className="text-xs text-ink-faint">
                        The job also wrote a digest sidecar ({fmtBytes(file.sidecarBytes)}); that file is gone too.
                      </span>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {centre.awaiting.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-display text-base font-semibold text-ink">Projects with nothing to download</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-dim">
            Each reason below is read from that project&apos;s own render job and its stage rows. Nothing here is
            written for the page.
          </p>
          <ul className="mt-4 space-y-3">
            {centre.awaiting.map((item) => (
              <li key={item.projectId}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-display text-sm font-semibold text-ink">
                      {item.projectTitle}
                    </p>
                    <Badge tone="neutral">{item.reasonCode}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-dim">{item.sentence}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
