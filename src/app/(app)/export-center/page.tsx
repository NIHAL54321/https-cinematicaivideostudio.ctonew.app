import { Clapperboard, CloudUpload, Film } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { ExportPanel } from "@/components/editor/export-panel";
import { RenderPipelinePanel } from "@/components/render/render-pipeline-panel";
import { ExportSpecPanel } from "@/components/render/export-spec-panel";
import { EXPORT_PRESETS, findExportPreset } from "@/lib/export/presets";
import { aiUpscaleState } from "@/lib/export/spec-status";
import { recommendPreset, recommendationView } from "@/lib/export/recommend";
import { measureProject } from "@/lib/export/measure";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listRenderJobs } from "@/lib/render/service";
import { ensureRenderWorker } from "@/lib/render/worker-boot";

export const metadata = { title: "Export Center" };

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function statusTone(status: string): "neutral" | "accent" | "ok" | "danger" {
  if (status === "COMPLETED") return "ok";
  if (status === "FAILED" || status === "CANCELLED") return "danger";
  if (status === "PROCESSING") return "accent";
  return "neutral";
}

export default async function ExportCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ specProject?: string; masterPreset?: string }>;
}) {
  const session = await requireUser();
  const { specProject, masterPreset } = await searchParams;
  const userId = session.userId;
  // Boot the queue worker from a request render — never at module scope, so
  // importing this module during `next build` or in a test starts nothing. A
  // job queued before a restart is picked up again on the next visit, with no
  // separate supervisor process.
  ensureRenderWorker();

  const [renderCount, exportCount, renders, exports, liveProjects] = await Promise.all([
    prisma.renderingJob.count({ where: { userId } }),
    prisma.exportJob.count({ where: { userId } }),
    prisma.renderingJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { project: { select: { id: true, title: true } } },
    }),
    prisma.exportJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { project: { select: { id: true, title: true } } },
    }),
    prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
  ]);

  // The most recent render-pipeline job, with its DERIVED status and progress.
  // A read failure must not take the page down: the panel simply starts empty.
  const [latestRender] = await listRenderJobs({ userId }).catch(() => [] as Awaited<ReturnType<typeof listRenderJobs>>);

  /* ---- Phase 8 block 2a: the specification surface -------------------------
   * The recommendation is computed from ONE project's own measured rows. The
   * selected project is the one in `?specProject=`, or the most recently updated
   * one; a project that is not this user's measures to null and no recommendation
   * is shown, which is the same 404-equivalent the API gives.
   */
  const specProjectId = (specProject && liveProjects.some((p) => p.id === specProject) ? specProject : liveProjects[0]?.id) ?? null;
  const measurement = specProjectId
    ? await measureProject({ projectId: specProjectId, userId }).catch(() => null)
    : null;
  const recommendation = measurement ? recommendationView(measurement, recommendPreset(measurement)) : null;
  const selectedPreset = findExportPreset(masterPreset ?? "youtube-2160p") ?? EXPORT_PRESETS[0];
  const providerState = aiUpscaleState();

  const stats = [
    { label: "Rendering jobs", value: renderCount, icon: Clapperboard, hint: "RenderingJob rows for your account" },
    { label: "Export jobs", value: exportCount, icon: CloudUpload, hint: "ExportJob rows for your account" },
    { label: "Total jobs", value: renderCount + exportCount, icon: Film, hint: "Combined render + export queue history" },
  ];

  return (
    <div>
      <PageHeader
        title="Export Center"
        description="The delivery specification for a project — presets, size estimate and the deliverable manifest, all from the export engine — plus every real render and export job on your account. No file exists and none is written: encoding needs a video-processing provider, which is named honestly below."
      />

      <ExportPanel projects={liveProjects} />

      <ExportSpecPanel
        presets={EXPORT_PRESETS}
        selectedPresetId={selectedPreset.id}
        selectedProjectId={specProjectId}
        projects={liveProjects}
        recommendation={recommendation}
        providerState={providerState}
      />

      <RenderPipelinePanel projects={liveProjects} initialJob={latestRender ?? null} />

      <div className="mt-8">
        <h2 className="font-display text-base font-semibold text-ink">Render &amp; export queue</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-dim">
          Every row below is real data from your account. The queue stays empty until a video-processing provider is connected —
          no job is ever simulated to fill it.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="glass-hover p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{s.label}</p>
              <s.icon size={16} strokeWidth={1.75} className="text-accent/80" />
            </div>
            <p className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">{s.value}</p>
            <p className="mt-1.5 text-xs text-ink-faint">{s.hint}</p>
          </Card>
        ))}
      </div>

      {renderCount === 0 && exportCount === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={CloudUpload}
            title="No render or export jobs yet"
            description="You have 0 rendering jobs and 0 export jobs. The specification above is real and complete, but no file is produced: the queue fills only once a video-processing provider is connected, and no job is ever simulated."
            bullets={[
              "Render long-form up to 120 min in 4K",
              "Vertical 9:16 Shorts renders",
              "Preview renders while you edit",
              "Export to YouTube and other platforms",
              "Per-job progress from the render queue",
            ]}
            note="Needs a connected provider"
          />
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {renders.length > 0 && (
            <section>
              <h2 className="font-display text-base font-semibold text-ink">Rendering jobs</h2>
              <p className="mt-1 text-sm text-ink-dim">
                {renderCount} rendering job{renderCount === 1 ? "" : "s"} on your account.
              </p>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
                <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="bg-panel-2 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      <th className="px-4 py-3 font-semibold">Project</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Resolution</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renders.map((r) => (
                      <tr key={r.id} className="border-t border-line text-ink-dim">
                        <td className="max-w-[220px] truncate px-4 py-3 text-ink">{r.project.title}</td>
                        <td className="px-4 py-3">{r.type}</td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        </td>
                        <td className="px-4 py-3">{r.resolution ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{fmtDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {exports.length > 0 && (
            <section>
              <h2 className="font-display text-base font-semibold text-ink">Export jobs</h2>
              <p className="mt-1 text-sm text-ink-dim">
                {exportCount} export job{exportCount === 1 ? "" : "s"} on your account.
              </p>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
                <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="bg-panel-2 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      <th className="px-4 py-3 font-semibold">Project</th>
                      <th className="px-4 py-3 font-semibold">Platform</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Format / resolution</th>
                      <th className="px-4 py-3 font-semibold">Output</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exports.map((e) => (
                      <tr key={e.id} className="border-t border-line text-ink-dim">
                        <td className="max-w-[220px] truncate px-4 py-3 text-ink">{e.project.title}</td>
                        <td className="px-4 py-3">{e.targetPlatform}</td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {e.format}
                          {e.resolution ? ` · ${e.resolution}` : ""}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3">
                          {e.outputUrl ? (
                            <a
                              href={e.outputUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:text-accent-strong"
                            >
                              Open output
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{fmtDate(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
