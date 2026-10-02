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

export function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      {NAV_SECTIONS.map((section) => (
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
