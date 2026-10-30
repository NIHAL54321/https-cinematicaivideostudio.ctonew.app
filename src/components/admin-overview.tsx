/**
 * THE OPERATOR SURFACE'S RENDERING — and nothing else (Phase 8, block 4).
 *
 * This component is handed an `AdminViewModel` and prints it. It has no data
 * access of any kind: no database, no filesystem, no environment, no clock, no
 * fetch. That is deliberate and it is tested — `src/lib/admin/__tests__/view.test.ts`
 * strips this file's CSS class names and comments and fails the build if a single
 * digit survives anywhere in it, so a figure cannot be typed here; it can only
 * arrive from the overview the API returns.
 *
 * The tone of a cell (ok / warn / bad / muted) is chosen by the view model, not
 * here, so the colour of a state and the meaning of a state are decided in one
 * place.
 */
import type { AdminCell, AdminSection, AdminTable, AdminViewModel, CellTone } from "@/lib/admin/view-model";

const TONE_CLASS: Record<CellTone, string> = {
  plain: "text-ink",
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  muted: "text-ink-faint",
};

function Cell({ cell }: { cell: AdminCell }) {
  return <span className={TONE_CLASS[cell.tone]}>{cell.text}</span>;
}

function Table({ table }: { table: AdminTable }) {
  return (
    <div className="mt-4">
      {/* Wide screens: the table itself, scrolling inside its own card so the page never scrolls sideways. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line-soft">
              {table.columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-line-soft/60 align-top">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 leading-relaxed">
                    <Cell cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Narrow screens: the same cells, stacked, so a row stays readable without a sideways scroll. */}
      <ul className="space-y-3 md:hidden">
        {table.rows.map((row, rowIndex) => (
          <li key={rowIndex} className="rounded-xl border border-line-soft bg-panel-2/40 p-3">
            <p className="text-[13px] font-semibold">
              <Cell cell={row[0]} />
            </p>
            <dl className="mt-2 space-y-1">
              {row.slice(1).map((cell, cellIndex) => (
                <div key={cellIndex}>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    {table.columns[cellIndex + 1] ?? ""}
                  </dt>
                  <dd className="text-[12px] leading-relaxed break-words">
                    <Cell cell={cell} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ section }: { section: AdminSection }) {
  const hasTable = section.tables.some((table) => table.rows.length > 0);
  const hasList = section.list.length > 0;
  return (
    <section id={section.id} className="rounded-2xl border border-line-soft bg-panel/60 p-4 lg:p-6">
      <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">{section.title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-dim break-words">{section.lead}</p>
      {section.statements.length > 0 ? (
        <div className="mt-3 space-y-2">
          {section.statements.map((statement, index) => (
            <p key={index} className="text-[12px] leading-relaxed text-ink-faint break-words">
              {statement}
            </p>
          ))}
        </div>
      ) : null}
      {hasTable ? section.tables.filter((table) => table.rows.length > 0).map((table, index) => <Table key={index} table={table} />) : null}
      {hasList ? (
        <ul className="mt-4 space-y-3">
          {section.list.map((item, index) => (
            <li key={index} className="rounded-xl border border-line-soft bg-panel-2/40 p-3">
              <p className="text-[13px] font-semibold text-ink break-words">{item.primary}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-dim break-words">{item.secondary}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {section.empty ? (
        <p className="mt-4 rounded-xl border border-dashed border-line-soft p-3 text-[12px] leading-relaxed text-ink-dim break-words">
          {section.empty}
        </p>
      ) : null}
    </section>
  );
}

export function AdminOverviewView({ model }: { model: AdminViewModel }) {
  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5">
      <header className="rounded-2xl border border-line-soft bg-panel/60 p-4 lg:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Operator surface</p>
        <h1 className="mt-1 font-display text-[22px] font-semibold tracking-tight text-ink">{model.heading}</h1>
        <p className="mt-2 max-w-4xl text-[13px] leading-relaxed text-ink-dim break-words">{model.subheading}</p>
        <p className="mt-3 text-[11px] text-ink-faint break-words">{model.readAtLine}</p>
        <p className="mt-1 text-[11px] text-ink-faint break-words">{model.operatorLine}</p>
        <ul className="mt-4 space-y-1.5 border-t border-line-soft pt-3">
          {model.notes.map((note, index) => (
            <li key={index} className="text-[11px] leading-relaxed text-ink-faint break-words">
              {note}
            </li>
          ))}
        </ul>
      </header>
      {model.sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </div>
  );
}
