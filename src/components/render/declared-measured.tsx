import { declaredVersusMeasured } from "@/lib/render/encoder-facts";

/**
 * DECLARED VERSUS MEASURED, side by side — the one component that puts the two
 * kinds of number next to each other on a screen.
 *
 * Why this exists (Phase 8, block 2b): the 2160p preset DECLARES HEVC Main at
 * level 5.1, and the delivered file the pipeline produced for it MEASURES level
 * 5.0 (ffprobe `level=150`). A page that printed only the declared level would
 * be telling a reader something about the specification while looking like a
 * statement about a file. So a surface that prints the resolved specification
 * shows both, each labelled, and says in words when they differ.
 *
 * No value is ever passed from the declared side into the measured sentence or
 * back: both come from `declaredVersusMeasured` in
 * `src/lib/render/encoder-facts.ts`, whose argument list keeps them apart. A
 * test (`declared-vs-measured.test.ts`) fails the build if a measured value is
 * rendered as if it were declared, or the reverse.
 */
export function DeclaredVersusMeasured({
  presetId,
  codec,
  profile,
  level,
  className = "",
}: {
  presetId: string;
  codec: string;
  profile: string;
  level: string | null;
  className?: string;
}) {
  const cmp = declaredVersusMeasured({ presetId, codec, profile, level });

  return (
    <div className={`mt-1.5 space-y-1 rounded-lg border border-line bg-panel-2/40 px-2 py-1.5 ${className}`}>
      <p className="break-words text-[11px] leading-relaxed text-ink-dim" data-fact="declared">
        {cmp.declaredLine}
      </p>
      {cmp.measuredLine && (
        <p className="break-words text-[11px] leading-relaxed text-ink-dim" data-fact="measured">
          {cmp.measuredLine}
        </p>
      )}
      {cmp.measuredLine === null && (
        <p className="break-words text-[11px] leading-relaxed text-ink-faint" data-fact="no-measurement">
          No file has been measured at this preset on this build, so there is no measured value to show beside the declared one —
          nothing is estimated to fill the gap.
        </p>
      )}
      {cmp.divergenceSentence && (
        <p className="break-words text-[11px] leading-relaxed text-accent/90" data-fact="divergence">
          {cmp.divergenceSentence}
        </p>
      )}
    </div>
  );
}
