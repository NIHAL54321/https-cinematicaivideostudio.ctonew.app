/**
 * THE OPERATOR SURFACE AS CELLS (Phase 8, block 4).
 *
 * The page renders THIS, and this is built only from an `AdminOverview` — the
 * object `GET /api/studio/admin/overview` returns. The split exists so the
 * honesty rule is enforceable rather than aspirational: the React component
 * receives nothing but strings and tone names, so it has no way to contribute a
 * figure of its own. A test (`__tests__/view.test.ts`) strips the component's
 * CSS class names and comments and fails the build if a single digit survives in
 * it — the negative control is a component that types "3 of 21" instead of
 * threading the matrix's own count.
 */
import type { AdminOverview } from "./overview";

export type CellTone = "plain" | "ok" | "warn" | "bad" | "muted";

export interface AdminCell {
  text: string;
  tone: CellTone;
}

export interface AdminTable {
  columns: string[];
  rows: AdminCell[][];
}

export interface AdminListItem {
  primary: string;
  secondary: string;
}

export interface AdminSection {
  id: string;
  title: string;
  /** One sentence above the table, saying how these cells were derived. */
  lead: string;
  statements: string[];
  tables: AdminTable[];
  list: AdminListItem[];
  /** Set only when there is genuinely nothing behind the section. */
  empty: string | null;
}

export interface AdminViewModel {
  heading: string;
  subheading: string;
  readAtLine: string;
  operatorLine: string;
  notes: string[];
  sections: AdminSection[];
}

const plain = (text: string | number | null): AdminCell => ({ text: text === null ? "—" : String(text), tone: "plain" });
const muted = (text: string): AdminCell => ({ text, tone: "muted" });

const STATE_TONE: Record<string, CellTone> = {
  present: "ok",
  gone: "warn",
  "size-mismatch": "bad",
  "digest-mismatch": "bad",
  unreadable: "bad",
  wired: "ok",
  "key missing": "warn",
  unbuilt: "muted",
  fits: "ok",
  "does not fit": "bad",
  "fits only under declared tuning": "warn",
  unknown: "muted",
};

const toneFor = (value: string): CellTone => STATE_TONE[value] ?? "plain";

export function buildAdminViewModel(overview: AdminOverview): AdminViewModel {
  const { counts, jobs, artefacts, encoder, capabilities, money, failures } = overview;

  const inventory: AdminSection = {
    id: "inventory",
    title: "What is in the database",
    lead:
      "Every figure here is a COUNT or groupBy query executed on this request. The synthetic column is derived from the " +
      "marking that already exists on the rows — this page invents no new marking and excludes nothing by hand.",
    statements: [
      counts
        .filter((c) => c.synthetic !== null)
        .map((c) => `${c.label}: ${c.synthetic} of ${c.total} row(s) are synthetic and therefore excluded from every user surface`)
        .join(" · "),
    ].filter((s) => s.length > 0),
    tables: [
      {
        columns: ["Table", "Rows", "Synthetic", "How the synthetic half is counted", "What the row is"],
        rows: counts.map((c) => [
          plain(c.label),
          plain(c.total),
          c.synthetic === null ? muted("not marked") : plain(`${c.synthetic} of ${c.total}`),
          muted(c.syntheticBasis),
          muted(c.note),
        ]),
      },
    ],
    list: [],
    empty: null,
  };

  const jobSection: AdminSection = {
    id: "render-jobs",
    title: "Render jobs, by derived status",
    lead:
      "A render job has no status column. Each job's status is computed from its own stage rows by deriveJobStatus() — " +
      "the same function the render API, the download centre and the pipeline tests use, so there is one rule and not two.",
    statements: [jobs.statusCovers.sentence, `Jobs in the table: ${jobs.total}, of which ${jobs.synthetic} are synthetic encoder proofs.`],
    tables: [
      {
        columns: ["Derived status", "Jobs", "What that status means"],
        rows: jobs.statuses.map((s) => [plain(s.status), plain(s.count), muted(s.definition)]),
      },
    ],
    list: [],
    empty: null,
  };

  const artefactSection: AdminSection = {
    id: "artefacts",
    title: "Artefacts, by derived state of their bytes",
    lead: artefacts.basis,
    statements: [
      `Artefact rows: ${artefacts.total}, of which ${artefacts.synthetic} are synthetic encoder proofs. Rows checked on this request: ${artefacts.checked}.`,
      ...artefacts.states.map((s) => `${s.state}: ${s.count} row(s), ${s.synthetic} of them synthetic. ${s.sentence}`),
    ],
    tables: [
      {
        columns: ["Derived state", "Rows", "Synthetic", "What was compared, in the check's own words"],
        rows: artefacts.states.map((s) => [
          { text: s.state, tone: toneFor(s.state) },
          plain(s.count),
          plain(s.synthetic),
          muted(s.sentence),
        ]),
      },
    ],
    list: [],
    empty: artefacts.empty,
  };

  const encoderSection: AdminSection = {
    id: "encoder",
    title: "The encoder, probed on this request",
    lead: encoder.headline,
    statements: [encoder.memorySentence, ...encoder.statements, `Probe stamps: ${encoder.checkedAt}.`],
    tables: [
      {
        columns: ["Probe", "Answer", "The probe's own evidence", "Checked at"],
        rows: encoder.probes.map((p) => [
          plain(p.probeId),
          { text: p.ok ? "passed" : "failed", tone: p.ok ? "ok" : "bad" },
          muted(p.ok ? p.detail : (p.missing ?? p.detail)),
          muted(p.checkedAt),
        ]),
      },
      {
        columns: ["Shipped preset", "Frame", "Verdict", "Basis — a measured peak against the memory available now"],
        rows: encoder.presetFit.map((f) => [
          plain(f.label),
          plain(f.frame),
          { text: f.verdict, tone: toneFor(f.verdict) },
          muted(f.basis),
        ]),
      },
    ],
    list: [],
    empty: null,
  };

  const capabilitySection: AdminSection = {
    id: "capabilities",
    title: "Provider capabilities",
    lead: capabilities.headline,
    statements: [
      `Adapters built: ${capabilities.adaptersBuilt} of ${capabilities.total}. Usable on this request: ${capabilities.wired} of ${capabilities.total}.`,
    ],
    tables: [
      {
        columns: ["Capability", "Provider", "State", "Key present", "Why this state"],
        rows: capabilities.rows.map((r) => [
          plain(r.label),
          r.provider === null ? muted("no provider slot") : plain(r.provider),
          { text: r.state, tone: toneFor(r.state) },
          { text: r.keysPresent ? "yes" : "no", tone: r.keysPresent ? "ok" : "muted" },
          muted(r.basis),
        ]),
      },
    ],
    list: [],
    empty: null,
  };

  const moneySection: AdminSection = {
    id: "money",
    title: "Money",
    lead: money.headline,
    statements: [...money.statements, `The three probes above ran at ${money.checkedAt}.`],
    tables: [],
    list: [],
    empty: null,
  };

  const failureSection: AdminSection = {
    id: "failures",
    title: "Recent failures, in the app's own words",
    lead:
      "Each sentence below is the one the download centre shows for that job — built by awaitingFromJob() from the job's " +
      "own stage row, not written for this page. A failure is explained in the app's words or not at all.",
    statements: [],
    tables: [],
    list: failures.rows.map((r) => ({
      primary:
        `${r.projectTitle} — job ${r.jobId} — ${r.status}` +
        (r.stage ? ` at ${r.stage}` : "") +
        (r.syntheticProof ? " — SYNTHETIC ENCODER PROOF (not a project's video)" : ""),
      secondary: r.sentence,
    })),
    empty: failures.empty,
  };

  return {
    heading: "Operator overview",
    subheading:
      "This surface states what the platform is, from queries and probes run on this request. Where nothing exists it says " +
      "so in words: no figure is drawn to fill a gap, and no area is summarised as a zero it never measured.",
    readAtLine: `Computed at ${overview.generatedAt}. Every section below was read at that moment; nothing on this page is cached.`,
    operatorLine: `Signed in as ${overview.operator.email} (role ${overview.operator.role}) — the role is read from the account's own row on this request.`,
    notes: overview.notes,
    sections: [inventory, jobSection, artefactSection, encoderSection, capabilitySection, moneySection, failureSection],
  };
}
