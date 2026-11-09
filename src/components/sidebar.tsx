import { Clapperboard } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import Link from "next/link";

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2 py-1 group">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft border border-accent-line text-accent shadow-glow">
        <Clapperboard size={18} strokeWidth={1.75} />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[13px] font-semibold tracking-tight text-ink">
          Cinematic AI
        </span>
        <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
          Video Studio
        </span>
      </span>
    </Link>
  );
}

export function SidebarNav({ pathname, isAdmin = false }: { pathname: string; isAdmin?: boolean }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      {NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => !item.adminOnly || isAdmin) }))
        .filter((section) => section.items.length > 0)
        .map((section) => (
        <div key={section.label}>
          <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                      active
                        ? "bg-accent-soft text-accent border border-accent-line/50"
                        : "text-ink-dim hover:text-ink hover:bg-panel-2 border border-transparent",
                    )}
                  >
                    <item.icon size={16} strokeWidth={1.75} className={active ? "text-accent" : "text-ink-faint"} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * OWNER AUTO SIGN-IN MARKER (Phase 8, owner-session block).
 *
 * A deployment where signing in is not a step must say so on every page, not in
 * a README. This sits in the sidebar footer, under the navigation and above the
 * account row, so it is visible wherever the owner is in the app. The sentence
 * itself comes from src/lib/owner-session/gate.ts (one source), passed in from
 * the (app) layout — which shows it only when the flag is on AND the signed-in
 * account is the account the flag names.
 */
export function OwnerSessionMarker({ text }: { text: string }) {
  return (
    <div className="mx-3 mb-2 rounded-xl border border-accent-line/60 bg-accent-soft/50 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Owner session</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">{text}</p>
    </div>
  );
}
