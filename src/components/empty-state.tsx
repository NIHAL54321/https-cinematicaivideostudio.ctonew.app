import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui";

/** Reusable empty-state panel for Phase 1 placeholder screens. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  note,
  bullets,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  note?: string;
  bullets?: string[];
}) {
  return (
    <div className="glass flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-2 border border-line text-ink-dim">
        <Icon size={24} strokeWidth={1.75} />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-dim">{description}</p>
      </div>
      {bullets?.length ? (
        <ul className="mx-auto mt-1 grid max-w-xl grid-cols-1 gap-1.5 text-left sm:grid-cols-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13px] text-ink-dim">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {b}
            </li>
          ))}
        </ul>
      ) : null}
      {note ? (
        <Badge tone="accent" className="mt-1">
          {note}
        </Badge>
      ) : null}
    </div>
  );
}
