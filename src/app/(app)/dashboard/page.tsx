import Link from "next/link";
import { ArrowRight, Film, FolderOpen, Layers, Sparkles, UploadCloud } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";

/**
 * Dashboard — empty-state stat cards with REAL numbers (zero for a fresh
 * account). No fabricated data, ever.
 */
export default async function DashboardPage() {
  const session = await requireUser();
  const userId = session.userId;

  const [projectCount, generationCount, assetCount, renderCount, latestVersion] = await Promise.all([
    prisma.project.count({ where: { userId, deletedAt: null } }),
    prisma.aIGeneration.count({ where: { userId } }),
    prisma.asset.count({ where: { userId, deletedAt: null } }),
    prisma.renderingJob.count({ where: { userId } }),
    prisma.projectVersion.count({ where: { createdById: userId } }),
  ]);

  const stats = [
    { label: "Projects", value: projectCount, icon: FolderOpen, hint: "Active, non-deleted projects" },
    { label: "AI generations", value: generationCount, icon: Sparkles, hint: "Every call is recorded (AIGeneration)" },
    { label: "Assets in library", value: assetCount, icon: Layers, hint: "Images, video, voice, music, subtitles" },
    { label: "Renders", value: renderCount, icon: Film, hint: "Rendering jobs created" },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome${session.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}`}
        description="Your studio at a glance — everything below is live data from your account."
        actions={
          <Link
            href="/create-video"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-[#171208] transition-colors hover:bg-accent-strong"
          >
            Start a video <ArrowRight size={15} />
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-accent-line/50 bg-accent-soft/40 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold text-ink">Faceless Mode</h2>
            <Badge tone="accent">Quick start</Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            No camera, no crew — the wizard opens with the Faceless Creator style pre-selected: visuals +
            voiceover only.
          </p>
          <Link
            href="/create-video?mode=faceless"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-[#171208] transition-colors hover:bg-accent-strong"
          >
            Start faceless <ArrowRight size={15} />
          </Link>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold text-ink">Your first video</h2>
            <Badge tone="accent">Next milestone</Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            The 8-step Create Video wizard arrives in the next milestone. For now your workspace, schema and
            services are ready — projects, scripts and scenes are already modeled in the database.
          </p>
          <ul className="mt-4 space-y-2 text-[13px] text-ink-dim">
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-accent" /> Project · Settings · Script · Chapters · Scenes
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-accent" /> Assets with per-kind extensions &amp; licensing
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-accent" /> Auto-save version history (ProjectVersion)
            </li>
          </ul>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold text-ink">Services</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            Local infrastructure is wired and running behind this app.
          </p>
          <ul className="mt-4 space-y-2 text-[13px] text-ink-dim">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> PostgreSQL 16 — schema migrated ({latestVersion} version snapshot{latestVersion === 1 ? "" : "s"} saved)
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Redis 7 — rate limits + BullMQ queues
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> MinIO — S3-compatible storage, bucket auto-provisioned on first use
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> AI providers — deliberately <span className="text-accent">Not Connected</span> (Phase 3+)
            </li>
          </ul>
          <Link
            href="/export-center"
            className="mt-5 inline-flex items-center gap-2 text-[13px] font-medium text-accent hover:text-accent-strong"
          >
            <UploadCloud size={14} /> Export Center <ArrowRight size={13} />
          </Link>
        </Card>
      </div>
    </div>
  );
}
