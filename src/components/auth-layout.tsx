import Link from "next/link";
import { Suspense } from "react";
import { Clapperboard } from "lucide-react";
import { AuthForm } from "@/components/auth-form";

export function AuthLayout({ mode }: { mode: "signin" | "signup" }) {
  const isSignup = mode === "signup";
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Cinematic brand panel */}
      <div className="relative hidden overflow-hidden border-r border-line-soft bg-abyss lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_30%_25%,rgba(232,180,90,0.12),transparent),radial-gradient(ellipse_50%_40%_at_80%_80%,rgba(138,124,246,0.08),transparent)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft border border-accent-line text-accent">
              <Clapperboard size={22} strokeWidth={1.75} />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-ink">Cinematic AI</span>
          </Link>

          <div className="max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">Phase 1 · Foundation</p>
            <h2 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight text-ink">
              One idea. A complete{" "}
              <span className="text-gradient-gold">cinematic video</span>.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-ink-dim">
              Script, storyboard, visuals, AI voice, music, subtitles, thumbnail, SEO and 4K export — long-form up
              to 120 minutes, Shorts in 9:16. Built for faceless channels.
            </p>
            <ul className="mt-6 space-y-2 text-[13px] text-ink-dim">
              {["Provider-independent AI with automatic fallback", "Brand Kit that travels across every video", "Auto-save with full version history"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-accent" /> {f}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-ink-faint">© {new Date().getFullYear()} Cinematic AI Video Studio</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-void px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft border border-accent-line text-accent">
                <Clapperboard size={17} strokeWidth={1.75} />
              </span>
              <span className="font-display text-sm font-semibold text-ink">Cinematic AI</span>
            </Link>
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 mb-8 text-sm text-ink-dim">
            {isSignup
              ? "Start building your first cinematic video in minutes."
              : "Sign in to your studio dashboard."}
          </p>

          <Suspense fallback={null}>
            <AuthForm mode={mode} />
          </Suspense>

          <p className="mt-6 text-center text-xs text-ink-faint">
            Passwords are hashed with scrypt. Sessions are httpOnly cookies — nothing else is stored in your
            browser.
          </p>
        </div>
      </div>
    </div>
  );
}
