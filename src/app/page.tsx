import Link from "next/link";
import {
  ArrowRight,
  Clapperboard,
  Film,
  Languages,
  Music,
  PenLine,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  HERO_HEADLINE,
  HONEST_BODY,
  HONEST_EYEBROW,
  HONEST_HEADING,
  honestFootnote,
  landingBadge,
  publicFeatures,
  studioSummary,
} from "@/lib/product/public-copy";

/**
 * The landing page — the first surface a visitor reads.
 *
 * This file owns NO claims. Every sentence below comes from
 * `src/lib/product/public-copy.ts`, which derives its numbers from the modules
 * that own them (the AI registry, the export presets, the export sizing
 * ceiling) and states this server's state nowhere, because this page is
 * prerendered. `src/lib/product/__tests__/public-copy.test.ts` holds each claim
 * to a fact in this repository; a sentence typed straight into this file would
 * be a sentence nobody re-checks.
 */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  structure: PenLine,
  delivery: Film,
  "lock-in": Wand2,
  audio: Languages,
};

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_-5%,rgba(232,180,90,0.14),transparent),radial-gradient(ellipse_40%_35%_at_85%_75%,rgba(138,124,246,0.08),transparent)]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft border border-accent-line text-accent">
            <Clapperboard size={18} strokeWidth={1.75} />
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-ink">Cinematic AI Video Studio</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/signin"
            className="rounded-xl px-4 py-2 text-sm font-medium text-ink-dim transition-colors hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-[#171208] shadow-[0_8px_24px_rgba(232,180,90,0.25)] transition-colors hover:bg-accent-strong"
          >
            Create account
          </Link>
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <section className="pt-20 text-center sm:pt-28">
          <p
            data-testid="landing-status-badge"
            className="mx-auto inline-flex items-center gap-2 rounded-full border border-accent-line/40 bg-accent-soft px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent"
          >
            <Sparkles size={12} /> {landingBadge()}
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-6xl">
            {HERO_HEADLINE.before}{" "}
            <span className="text-gradient-gold">{HERO_HEADLINE.accent}</span>
            {HERO_HEADLINE.after}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-dim sm:text-lg">
            {studioSummary()}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-7 text-base font-semibold text-[#171208] shadow-[0_8px_24px_rgba(232,180,90,0.25)] transition-colors hover:bg-accent-strong"
            >
              Start creating <ArrowRight size={17} />
            </Link>
            <Link
              href="/signin"
              className="inline-flex h-12 items-center rounded-xl border border-line bg-panel/60 px-7 text-base font-medium text-ink transition-colors hover:bg-panel-2"
            >
              Open the dashboard
            </Link>
          </div>
        </section>

        <section className="mt-24 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {publicFeatures().map((f) => {
            const Icon = FEATURE_ICONS[f.id] ?? Sparkles;
            return (
              <div key={f.id} className="glass glass-hover p-5">
                <Icon size={20} strokeWidth={1.75} className="text-accent" />
                <h3 className="mt-3 font-display text-[15px] font-semibold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{f.desc}</p>
              </div>
            );
          })}
        </section>

        <section className="mt-24 rounded-3xl border border-line-soft bg-abyss/60 p-8 sm:p-12">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">{HONEST_EYEBROW}</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{HONEST_HEADING}</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-dim">{HONEST_BODY}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-faint" data-testid="landing-wiring-footnote">
              <Music size={14} className="text-accent/70" />
              {honestFootnote()}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line-soft py-6 text-center text-xs text-ink-faint">
        © {new Date().getFullYear()} Cinematic AI Video Studio
      </footer>
    </div>
  );
}
