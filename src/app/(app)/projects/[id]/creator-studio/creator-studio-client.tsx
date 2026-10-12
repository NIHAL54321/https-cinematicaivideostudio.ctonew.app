"use client";
/**
 * Phase 7 Block 2 — the Creator Studio surface.
 *
 * This component renders exactly what ./page built: a view model of the STORED
 * publishing package (or the honest empty view when nothing is saved). Two rules
 * hold it together, and `studio-copy.test.ts` enforces both:
 *
 *   - every sentence it shows comes from ../studio-copy (scanned for banned
 *     claims, forward promises and market-metric names) or from the view itself
 *     (this project's own rows, or the package's own words, with provenance);
 *   - it never claims a state it is not in. The build button's label changes only
 *     while a real request is in flight, there is no progress element anywhere,
 *     and the result line reports what the server actually answered.
 *
 * The only action here is POST /api/studio/publishing { action: "build" }, which
 * derives a package from this project's rows and appends it as a new version.
 * Nothing on this page calls a provider, and nothing simulates one.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileLock2, Info, Layers, PlugZap } from "lucide-react";
import { apiFetch } from "@/components/projects/client-api";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import {
  AUDIT_COPY,
  BUILD_ACTION_BUSY_LABEL,
  BUILD_ACTION_LABEL,
  BUILD_ACTION_NOTE,
  BUILD_RESULT_COPY,
  EMPTY_VIEW_COPY,
  LICENCE_COPY,
  NOT_IN_PACKAGE_BLOCK_LABEL,
  NOT_IN_PACKAGE_CHIP,
  NOT_IN_PACKAGE_ENV_LABEL,
  NOT_IN_PACKAGE_NEEDS_PROVIDER,
  NOT_IN_PACKAGE_NO_PROVIDER,
  ORIGIN_PHRASE,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PROVENANCE_ENV_LABEL,
  PROVENANCE_NOTE_LABEL,
  PROVENANCE_ORIGIN_LABEL,
  PROVENANCE_REQUIRES_LABEL,
  PROVENANCE_RULE_LABEL,
  PROVENANCE_SOURCES_LABEL,
  PROVENANCE_SUMMARY,
  PROVENANCE_TEMPLATE_LABEL,
  QUOTED_PROJECT_TEXT_COPY,
  SECTION_COPY,
  SUMMARY_COPY,
} from "@/lib/publishing/studio-copy";
import type {
  CreatorStudioView,
  StudioGroup,
  StudioRow,
  StudioSection,
  StudioValue,
} from "@/lib/publishing/studio-view";
import { quotedSegments, type QuotedSegments } from "@/lib/publishing/quoted-text";

/* ------------------------------------------------------------------ */
/* One value, with its state and its provenance                        */
/* ------------------------------------------------------------------ */

const STATE_TONE: Record<StudioValue["state"], "ok" | "neutral" | "accent"> = {
  derived: "ok",
  empty_no_input: "neutral",
  gated_provider: "accent",
};

/**
 * Which characters of a value are the PROJECT's, declared as such, is decided by
 * `quotedSegments` (`@/lib/publishing/quoted-text`) — never guessed here. It
 * answers only for a value whose declared `textOrigin` is `template_filled` with
 * fragments, whose substitution reproduces the value's own text character for
 * character; `./publishing/audit` verifies the same substitution against the rows
 * before exempting the sentence from the banned-claims scan (see `./quotation`).
 * A value that quotes nothing — or whose declared fragments do not account for
 * its characters — gets no mark at all and renders as this app's own sentence.
 */
function QuotedText({ segments }: { segments: QuotedSegments }) {
  return (
    <span className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {segments.map((segment, i) =>
        segment.quoted ? (
          <mark
            key={`quoted-${i}`}
            data-testid="studio-quoted-fragment"
            data-quoted="true"
            title={segment.from}
            className="rounded-sm bg-accent-soft px-0.5 font-medium text-accent-strong"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`authored-${i}`} data-testid="studio-authored-text" data-quoted="false" className="text-ink-dim">
            {segment.text}
          </span>
        ),
      )}
    </span>
  );
}
function ValueContent({ value }: { value: StudioValue }) {
  if (value.state === "derived") {
    return (
      <span className="whitespace-pre-wrap break-words text-sm text-ink">
        {typeof value.value === "string" ? value.value : (value.display ?? String(value.value))}
      </span>
    );
  }
  return (
    <span className="text-sm leading-relaxed text-ink-dim">
      {value.reason}
      {value.requires.length > 0 ? (
        <span className="mt-1 block text-[12px] text-ink-faint">
          {PROVENANCE_REQUIRES_LABEL}: {value.requires.join(" · ")}
        </span>
      ) : null}
      {value.state === "gated_provider" && value.envVars.length > 0 ? (
        <span className="mt-1 block text-[12px] text-ink-faint">
          {PROVENANCE_ENV_LABEL}: {value.envVars.join(" · ")}
        </span>
      ) : null}
    </span>
  );
}

function Provenance({ value }: { value: StudioValue }) {
  return (
    <details data-testid="studio-provenance" data-rule={value.rule ?? "none"} className="mt-1.5">
      <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wider text-ink-faint hover:text-ink-dim">
        {PROVENANCE_SUMMARY}
      </summary>
      <dl className="mt-2 space-y-1 rounded-lg border border-line/70 bg-panel-2/50 p-2.5 text-[12px] text-ink-dim">
        {value.rule ? (
          <>
            <div>
              <dt className="inline text-ink-faint">{PROVENANCE_RULE_LABEL}: </dt>
              <dd className="inline font-mono text-[11px] text-accent">{value.rule}</dd>
            </div>
            {value.ruleWhat ? (
              <div>
                <dd>{value.ruleWhat}</dd>
              </div>
            ) : null}
          </>
        ) : null}
        {value.sources.length > 0 ? (
          <div>
            <dt className="text-ink-faint">{PROVENANCE_SOURCES_LABEL}:</dt>
            <dd>
              <ul className="mt-0.5 space-y-0.5">
                {value.sources.slice(0, 8).map((s, i) => (
                  <li key={`${s.kind}-${s.id}-${s.path ?? ""}-${i}`} className="font-mono text-[11px]">
                    {s.kind} {s.id}
                    {s.path ? ` · ${s.path}` : ""}
                    {s.span ? ` · chars ${s.span.start}–${s.span.end}` : ""}
                  </li>
                ))}
              </ul>
              {value.sources.length > 8 ? (
                <span className="text-[11px] text-ink-faint">
                  {value.sources.length - 8} further source row(s) on this value.
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {value.textOrigin ? (
          <div>
            <dt className="inline text-ink-faint">{PROVENANCE_ORIGIN_LABEL}: </dt>
            <dd className="inline">{ORIGIN_PHRASE[value.textOrigin]}</dd>
          </div>
        ) : null}
        {value.templateText ? (
          <div>
            <dt className="inline text-ink-faint">{PROVENANCE_TEMPLATE_LABEL}: </dt>
            <dd data-testid="studio-template-text" className="inline font-mono text-[11px]">
              {value.templateText}
            </dd>
          </div>
        ) : null}
        {value.note ? (
          <div>
            <dt className="inline text-ink-faint">{PROVENANCE_NOTE_LABEL}: </dt>
            <dd className="inline">{value.note}</dd>
          </div>
        ) : null}
        {value.state !== "derived" ? (
          <div>
            <dt className="inline text-ink-faint">{PROVENANCE_REQUIRES_LABEL}: </dt>
            <dd className="inline">{value.requires.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function ValueBlock({ value }: { value: StudioValue }) {
  const segments = quotedSegments(value);
  return (
    <div
      data-testid="studio-value"
      data-label={value.label}
      data-state={value.state}
      data-rule={value.rule ?? "none"}
      data-quoted={segments ? "true" : "false"}
      data-quoted-fragments={segments ? segments.filter((segment) => segment.quoted).length : 0}
      className="border-t border-line/60 py-2.5 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wider text-ink-faint">{value.label}</span>
        <Badge tone={STATE_TONE[value.state]}>{value.stateLabel}</Badge>
        {segments ? (
          <span
            data-testid="studio-quoted-chip"
            data-quoted="true"
            className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-accent"
          >
            {QUOTED_PROJECT_TEXT_COPY.chip}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5">
        {segments ? (
          <div
            data-testid="studio-quoted-text"
            data-quoted="true"
            className="rounded-r-lg border-l-2 border-accent-line bg-panel-2/40 px-2.5 py-1.5"
          >
            <QuotedText segments={segments} />
          </div>
        ) : (
          <ValueContent value={value} />
        )}
      </div>
      {segments ? (
        <p data-testid="studio-quoted-note" className="mt-1.5 text-[12px] text-ink-dim">
          {QUOTED_PROJECT_TEXT_COPY.authorship}{" "}
          {QUOTED_PROJECT_TEXT_COPY.templatePrefix}{" "}
          <span data-testid="studio-quoted-template" className="font-mono text-[11px] text-ink-faint">
            {value.templateText}
          </span>
        </p>
      ) : null}
      <Provenance value={value} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows and groups                                                     */
/* ------------------------------------------------------------------ */

function RowBlock({ row, depth = 0 }: { row: StudioRow; depth?: number }) {
  return (
    <div
      data-testid="studio-row"
      data-kind={row.kind}
      data-row-id={row.id}
      className={depth > 0 ? "mt-3 border-l border-line/70 pl-3" : "mt-4 border-t border-line/60 pt-3"}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold text-ink-dim">{row.label}</span>
        {row.texts.map((t) => (
          <span key={t.value} className="font-mono text-[11px] text-ink-faint">
            {t.value}
          </span>
        ))}
      </div>
      {row.reason ? <p className="mt-1 text-[12px] text-ink-dim">{row.reason}</p> : null}
      <div className="mt-1.5">
        {row.values.map((v) => (
          <ValueBlock key={`${row.id}-${v.label}`} value={v} />
        ))}
      </div>
      {row.notes.map((n) => (
        <p key={n} className="mt-1 text-[12px] text-ink-faint">
          {n}
        </p>
      ))}
      {(row.children ?? []).map((child) => (
        <RowBlock key={child.id} row={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function GroupBlock({ group }: { group: StudioGroup }) {
  return (
    <div data-testid="studio-group" data-group-id={group.id} className="mt-4 border-t border-line/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-dim">{group.label}</span>
        <Badge tone="neutral">{String(group.items.length)}</Badge>
      </div>
      {group.reason ? <p className="mt-1 text-[12px] text-ink-dim">{group.reason}</p> : null}
      {group.items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {group.items.map((item) => (
            <li key={item.id} data-testid="studio-group-item" className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-ink">{item.value}</span>
              <span className="text-[11px] text-ink-faint">{item.detail}</span>
              {item.rule ? <span className="font-mono text-[11px] text-accent">{item.rule}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SectionCard({ section }: { section: StudioSection }) {
  return (
    <Card data-testid={`studio-section-${section.id}`} data-section-id={section.id} className="mb-6 px-5 py-5">
      <h2 className="font-display text-lg font-semibold text-ink">{section.title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{section.basis}</p>

      {section.emptyReason ? (
        <div
          data-testid={`studio-empty-${section.id}`}
          className="mt-4 rounded-xl border border-line bg-panel-2/60 px-4 py-3"
        >
          <p className="text-[13px] leading-relaxed text-ink-dim">{section.emptyReason}</p>
          {section.emptyRequires.length > 0 ? (
            <p className="mt-1.5 text-[12px] text-ink-faint">
              {PROVENANCE_REQUIRES_LABEL}: {section.emptyRequires.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {section.values.map((v) => (
        <ValueBlock key={`${section.id}-${v.label}`} value={v} />
      ))}
      {section.groups.map((g) => (
        <GroupBlock key={g.id} group={g} />
      ))}
      {section.rows.map((r) => (
        <RowBlock key={r.id} row={r} />
      ))}

      {section.notes.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-line/60 pt-3">
          {section.notes.map((n) => (
            <li key={n} className="text-[12px] leading-relaxed text-ink-faint">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export function CreatorStudioClient({ projectId, view }: { projectId: string; view: CreatorStudioView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const body = await apiFetch<{ persisted?: { version?: number } }>("/api/studio/publishing", {
        method: "POST",
        body: JSON.stringify({ action: "build", projectId }),
      });
      const version = body.persisted?.version;
      setResult(
        version === undefined
          ? BUILD_RESULT_COPY.noVersion
          : `${BUILD_RESULT_COPY.savedPrefix} ${version} ${BUILD_RESULT_COPY.savedSuffix}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : BUILD_RESULT_COPY.failed);
    } finally {
      setBusy(false);
    }
  }

  const heading = view.kind === "package" ? `${view.projectTitle} — ${PAGE_TITLE}` : PAGE_TITLE;

  return (
    <div data-testid="creator-studio-page" data-view-kind={view.kind}>
      <PageHeader
        title={heading}
        description={PAGE_DESCRIPTION}
        actions={
          <Button data-testid="creator-studio-build" onClick={build} disabled={busy}>
            {busy ? BUILD_ACTION_BUSY_LABEL : BUILD_ACTION_LABEL}
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone="accent">{PAGE_TITLE}</Badge>
        <span className="text-[12px] text-ink-faint">{BUILD_ACTION_NOTE}</span>
      </div>

      {result ? (
        <p
          data-testid="creator-studio-build-result"
          className="mb-6 rounded-lg border border-ok/25 bg-ok/10 px-3 py-2 text-[13px] text-ok"
        >
          <Check size={13} className="mr-1 inline" /> {result}
        </p>
      ) : null}
      {error ? (
        <p
          data-testid="creator-studio-build-error"
          className="mb-6 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          <AlertTriangle size={13} className="mr-1 inline" /> {error}
        </p>
      ) : null}

      {view.kind === "empty" ? (
        <>
          <Card className="mb-6 px-5 py-5" data-testid="creator-studio-nothing-saved">
            <div className="flex items-start gap-3">
              <FileLock2 size={18} className="mt-0.5 shrink-0 text-ink-dim" />
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">{view.title}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{view.body}</p>
                <p className="mt-2 text-[12px] text-ink-faint">
                  {PROVENANCE_REQUIRES_LABEL}: {view.requires.join(" · ")}
                </p>
              </div>
            </div>
          </Card>
          <Card className="mb-6 px-5 py-5" data-testid="studio-section-versions">
            <h2 className="font-display text-lg font-semibold text-ink">{EMPTY_VIEW_COPY.versionsTitle}</h2>
            <p data-testid="studio-empty-versions" className="mt-1 text-[12px] text-ink-faint">
              {EMPTY_VIEW_COPY.versionsEmpty}
            </p>
          </Card>
        </>
      ) : (
        <>
          <p
            data-testid="creator-studio-honesty-statement"
            className="mb-6 rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-[13px] leading-relaxed text-ink-dim"
          >
            {view.honestyStatement}
          </p>

          <Card className="mb-6 px-5 py-5" data-testid="creator-studio-legend">
            <h2 className="font-display text-base font-semibold text-ink">{view.legend.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {view.legend.chips.map((chip) => (
                <Badge key={chip.id} tone={STATE_TONE[chip.id]}>
                  {chip.label}
                </Badge>
              ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {view.legend.lines.map((line) => (
                <li key={line} className="text-[12px] leading-relaxed text-ink-dim">
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-line/60 pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-dim">{SUMMARY_COPY.title}</h3>
              <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {view.fieldStates.map((f) => (
                  <li key={f.label} className="flex items-baseline justify-between gap-3 text-[12px] text-ink-dim">
                    <span>{f.label}</span>
                    <span className="font-mono text-ink">{String(f.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {view.sections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}

          <Card className="mb-6 px-5 py-5" data-testid="studio-section-gated">
            <div className="flex items-center gap-2">
              <PlugZap size={16} className="text-ink-dim" />
              <h2 className="font-display text-lg font-semibold text-ink">{SECTION_COPY.gated.title}</h2>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{SECTION_COPY.gated.basis}</p>
            <div className="mt-4 space-y-4">
              {view.notInThisPackage.map((entry) => (
                <div
                  key={entry.id}
                  data-testid={`creator-studio-not-in-package-${entry.id}`}
                  data-needs-provider={String(entry.needsProvider)}
                  className="border-t border-line/60 pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{entry.label}</span>
                    <Badge tone="neutral">{NOT_IN_PACKAGE_CHIP}</Badge>
                    <Badge tone={entry.needsProvider ? "accent" : "neutral"}>
                      {entry.needsProvider ? NOT_IN_PACKAGE_NEEDS_PROVIDER : NOT_IN_PACKAGE_NO_PROVIDER}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{entry.reason}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {NOT_IN_PACKAGE_BLOCK_LABEL}: {entry.block}
                  </p>
                  {entry.envVars.length > 0 ? (
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {NOT_IN_PACKAGE_ENV_LABEL}: <span className="font-mono">{entry.envVars.join(" · ")}</span>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card className="mb-6 px-5 py-5" data-testid="studio-section-audit">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-ink-dim" />
              <h2 className="font-display text-lg font-semibold text-ink">{SECTION_COPY.audit.title}</h2>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{AUDIT_COPY.whatItChecks}</p>
            <div className="mt-3 space-y-3">
              {[view.selfAudit, view.reAudit].filter((a): a is NonNullable<typeof a> => a !== null).map((audit) => (
                <div key={audit.label} data-testid="studio-audit" data-ok={String(audit.ok)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-dim">{audit.label}</span>
                    <Badge tone={audit.ok ? "ok" : "danger"}>
                      {audit.ok ? AUDIT_COPY.ok : `${audit.violationCount} ${AUDIT_COPY.violations}`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {audit.inspectedKeys} {AUDIT_COPY.inspectedKeys} · {audit.inspectedStrings}{" "}
                    {AUDIT_COPY.inspectedStrings} · {audit.checkedAt}
                  </p>
                  {audit.violations.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {audit.violations.map((v) => (
                        <li key={`${v.path}-${v.kind}`} className="font-mono text-[11px] text-danger">
                          {v.path} ({v.kind}) {v.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card className="mb-6 px-5 py-5" data-testid="studio-section-versions">
            <h2 className="font-display text-lg font-semibold text-ink">{SECTION_COPY.versions.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{SECTION_COPY.versions.basis}</p>
            <div className="mt-3">
              {view.versionRows.length === 0 ? (
                <p data-testid="studio-empty-versions" className="text-[12px] text-ink-faint">
                  {EMPTY_VIEW_COPY.versionsEmpty}
                </p>
              ) : (
                view.versionRows.map((row) => <RowBlock key={row.id} row={row} />)
              )}
            </div>
          </Card>

          <Card className="px-5 py-5" data-testid="studio-section-licence-note">
            <div className="flex items-start gap-3">
              <Info size={16} className="mt-0.5 shrink-0 text-ink-dim" />
              <div>
                <h2 className="font-display text-base font-semibold text-ink">{LICENCE_COPY.notClearanceTitle}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{LICENCE_COPY.notClearance}</p>
                <p className="mt-1.5 text-[12px] text-ink-faint">{LICENCE_COPY.notClearanceFootnote}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
