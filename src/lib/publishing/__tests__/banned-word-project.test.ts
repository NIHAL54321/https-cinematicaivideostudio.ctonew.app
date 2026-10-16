/**
 * P7-3b — THE BANNED-WORD PROJECT, and the quotation mechanism that makes it build.
 *
 * The defect these tests pin down, from the real project that hit it: the audit
 * phrase-scans every sentence this app writes, and it could not tell the app's own
 * words from the project's characters embedded INSIDE one of those sentences. A
 * project whose own stored text contains a banned word failed its own build with 62
 * violations (`keywords.buckets[3].reason`, `keywords.notes[0]`, and sixteen
 * `titles…features[].measured` lines naming the title's first word).
 *
 * What these tests hold, and what they must never be made to hold by weakening the
 * check:
 *   1. a project whose own text contains EVERY banned word still builds, and the
 *      package's own audit says ok;
 *   2. a banned claim THIS APP wrote still fails the build — in a template, in a
 *      rule-authored sentence, in a quotation's TEMPLATE, and in the app's own half
 *      of the view;
 *   3. a quotation cannot smuggle anything: the sentence must reproduce its own
 *      template and its own fragments byte for byte, every fragment must name the
 *      row it was read from, and a template_filled value that declares no fragments
 *      gets no exemption at all — it is scanned.
 */
import { describe, expect, test } from "bun:test";
import { BANNED_CLAIMS, auditPublishingPackage, PublishingHonestyError } from "../audit";
import { buildPublishingPackage } from "../package";
import { quotation, quotedFragment, renderQuotation, inspectQuotation } from "../quotation";
import { richSource } from "./fixtures";
import { derived } from "../provenance";

import {
  WHOLE_VALUE_PLACEHOLDER,
  buildCreatorStudioView,
  buildEmptyCreatorStudioView,
  studioValue,
  wholeValueDeclaration,
  type StudioValue,
} from "../studio-view";
import { quotedCharacters, quotedSegments } from "../quoted-text";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const OPTS = { now: NOW, modelCopyEnvNames: ["OPENAI_API_KEY"] as string[], selfAudit: true as const };

/** A project whose own words use every phrase this app's own prose may not. */
function bannedWordSource() {
  const source = richSource();
  const allBanned = BANNED_CLAIMS.join(" and ");
  source.project.title = `Viral marketing: the guaranteed guide to optimized growth`;
  source.project.description =
    `How a channel can be optimized for viral reach, how to rank higher with high-volume niche wording, and why nobody can promise a guaranteed outcome. ` +
    `Every one of these phrases is the project's own subject matter, not a claim by this app. ${allBanned}.`;
  source.settings = {
    seoDefaultsDescription: null,
    language: "en",
    tone: "viral growth marketing",
    style: "search-optimized explainer",
    targetAudience: "creators who want to boost your views",
  };
  if (source.script) {
    source.script.title = "The guaranteed viral formula that optimises nothing";
    source.script.logline =
      "A video about viral marketing, ranking higher, best-performing wording and top-ranking clickbait — described, never promised.";
  }
  source.chapters[0].title = "The viral hook that guarantees nothing";
  source.chapters[0].scenes[0].narration =
    "Nobody can guarantee a viral video, and no title can be optimized into a guaranteed win. " +
    "That is the whole subject of this video, in the project's own words.";
  return source;
}

/** Every banned phrase, as characters, appearing in the project's own stored text. */
function projectText(source: ReturnType<typeof richSource>): string {
  return [
    source.project.title,
    source.project.description ?? "",
    source.settings?.tone ?? "",
    source.settings?.style ?? "",
    source.settings?.targetAudience ?? "",
    source.script?.title ?? "",
    source.script?.logline ?? "",
    ...source.chapters.flatMap((c) => [c.title, c.summary ?? "", ...c.scenes.flatMap((s) => [s.title ?? "", s.narration ?? ""])]),
  ].join("\n");
}

describe("P7-3b — a project whose own text contains every banned word still builds", () => {
  test("the fixture really does carry every banned phrase in the project's OWN text", () => {
    const lower = projectText(bannedWordSource()).toLowerCase();
    for (const phrase of BANNED_CLAIMS) expect(lower.includes(phrase)).toBe(true);
  });

  test("the package builds, saves nothing, and its own audit says ok", () => {
    const pkg = buildPublishingPackage(bannedWordSource(), OPTS);
    expect(pkg.selfAudit.ok).toBe(true);
    expect(pkg.selfAudit.violationCount).toBe(0);
    // The audit really walked the package, and it really exempted quotations.
    expect(pkg.selfAudit.inspectedStrings).toBeGreaterThan(200);
    expect(pkg.selfAudit.quotedSentences).toBeGreaterThan(0);
    expect(pkg.selfAudit.quotedFragments).toBeGreaterThan(0);
    const reAudit = auditPublishingPackage(pkg, { now: NOW });
    expect(reAudit.ok).toBe(true);
  });

  test("no app-authored sentence in that package carries a banned word", () => {
    const pkg = buildPublishingPackage(bannedWordSource(), OPTS);
    const sentences: string[] = [];
    for (const bucket of pkg.keywords.buckets) if (bucket.reason) sentences.push(bucket.reason);
    sentences.push(...pkg.keywords.notes);
    for (const option of pkg.titles.titles) {
      for (const axis of option.axes) {
        for (const feature of axis.features) {
          sentences.push(feature.measured);
          // A quotation's TEMPLATE is the app's own words too — it is what the
          // audit scans in the sentence's place.
          if (feature.measuredQuote) sentences.push(feature.measuredQuote.templateText);
        }
      }
    }
    sentences.push(pkg.chapters.notes.join(" "));
    for (const tag of pkg.tags.tags) if (tag.note) sentences.push(tag.note);
    sentences.push(...pkg.tags.notes);
    const lower = sentences.join("\n").toLowerCase();
    for (const phrase of BANNED_CLAIMS) {
      expect(lower.includes(phrase), `app-authored sentence carries "${phrase}"`).toBe(false);
    }
  });

  test("the measurement that names the title's own word carries it as a QUOTATION", () => {
    const pkg = buildPublishingPackage(bannedWordSource(), OPTS);
    const quoted = pkg.titles.titles.flatMap((t) => t.axes.flatMap((a) => a.features)).filter((f) => f.measuredQuote !== null);
    expect(quoted.length).toBeGreaterThan(0);
    for (const feature of quoted) {
      const quote = feature.measuredQuote!;
      // The sentence reproduces its own template with its own fragments…
      expect(renderQuotation(quote.templateText, quote.fragments)).toBe(quote.text);
      // …the app's own template is scanned in its place (and is clean)…
      expect(quote.templateText).toContain("{WORD}");
      // …and every quoted character names the row it was read from.
      for (const fragment of quote.fragments) {
        expect(fragment.textOrigin).toBe("source_verbatim");
        expect(fragment.sources.length).toBeGreaterThan(0);
        expect(fragment.from.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("P7-3b — the app's own words are still checked, and the teeth are unchanged", () => {
  test("a banned claim in an app-authored sentence still fails", () => {
    const ours = {
      note: {
        state: "derived",
        value: "This keyword set is optimized for growth.",
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "rule_authored",
      },
    };
    const result = auditPublishingPackage(ours);
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("banned_claim");
  });

  test("a banned claim in a quotation's TEMPLATE fails: the app's half is scanned", () => {
    const smuggler = {
      sentence: {
        state: "derived",
        value: 'our wording is "guaranteed" to work',
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "template_filled",
        templateText: 'our wording is "{WORD}" to work',
        fragments: [
          { placeholder: "{WORD}", text: "guaranteed", textOrigin: "source_verbatim", sources: [{ kind: "project", id: "p" }], from: "Project.title" },
        ],
      },
    };
    // Hmm: this template is clean; the CLAIM is the quoted word. That is the
    // project's own word and must pass. The next test writes the claim into the
    // app's own half and must fail.
    expect(auditPublishingPackage(smuggler).ok).toBe(true);
    const claimInTemplate = structuredClone(smuggler);
    claimInTemplate.sentence.templateText = 'our wording is "{WORD}", guaranteed to work';
    const result = auditPublishingPackage(claimInTemplate);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });

  test("a sentence the app cannot reproduce from its own template and fragments FAILS", () => {
    // The app wrote "will rank" itself, then declared a fragment for a different
    // phrase: the sentence carries characters no declared fragment accounts for.
    const smuggled = {
      sentence: {
        state: "derived",
        value: 'the topic of this video is "will rank"',
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "template_filled",
        templateText: 'the topic of this video is "{TOPIC}"',
        fragments: [
          { placeholder: "{TOPIC}", text: "carthage", textOrigin: "source_verbatim", sources: [{ kind: "project", id: "p", path: "title" }], from: "Project.title" },
        ],
      },
    };
    const result = auditPublishingPackage(smuggled);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "unverifiable_quotation")).toBe(true);
    // And the sentence is scanned as this app's own on top of that.
    expect(result.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });

  test("a template_filled value with NO fragments is NOT exempt — it is scanned", () => {
    const undeclared = {
      sentence: {
        state: "derived",
        value: "guaranteed results for every channel",
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "template_filled",
      },
    };
    const result = auditPublishingPackage(undeclared);
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("banned_claim");
    expect(result.unverifiedTemplateFills).toBe(1);
  });

  test("a quoted fragment with no source row, or a placeholder the template never uses, is refused", () => {
    const noSource = {
      sentence: {
        state: "derived",
        value: 'a video about "carthage"',
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "template_filled",
        templateText: 'a video about "{TOPIC}"',
        fragments: [{ placeholder: "{TOPIC}", text: "carthage", textOrigin: "source_verbatim", sources: [], from: "somewhere" }],
      },
    };
    expect(auditPublishingPackage(noSource).ok).toBe(false);

    const unusedPlaceholder = {
      sentence: {
        state: "derived",
        value: "a video about carthage",
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "template_filled",
        templateText: "a video about carthage",
        fragments: [
          { placeholder: "{TOPIC}", text: "carthage", textOrigin: "source_verbatim", sources: [{ kind: "project", id: "p" }], from: "Project.title" },
        ],
      },
    };
    expect(auditPublishingPackage(unusedPlaceholder).ok).toBe(false);

    const ruleAuthoredFragment = {
      sentence: {
        state: "derived",
        value: "a video about things",
        rule: "R-PINNED-COMMENT",
        sources: [{ kind: "project", id: "p" }],
        textOrigin: "template_filled",
        templateText: "a video about {TOPIC}",
        fragments: [{ placeholder: "{TOPIC}", text: "things", textOrigin: "rule_authored", sources: [{ kind: "project", id: "p" }], from: "nowhere" }],
      },
    };
    expect(auditPublishingPackage(ruleAuthoredFragment).ok).toBe(false);
  });

  test("the quotation helper refuses half a declaration rather than trusting it", () => {
    expect(() => quotation("a video about {TOPIC}", [])).toThrow();
    expect(() =>
      quotation("a video about nothing", [
        quotedFragment({ placeholder: "{TOPIC}", text: "carthage", sources: [{ kind: "project", id: "p" }], from: "Project.title" }),
      ]),
    ).toThrow();
    expect(() =>
      quotation("a video about {TOPIC}", [
        quotedFragment({ placeholder: "{TOPIC}", text: "carthage", sources: [], from: "Project.title" }),
      ]),
    ).toThrow();
    const ok = quotation("a video about {TOPIC}", [
      quotedFragment({ placeholder: "{TOPIC}", text: "carthage", sources: [{ kind: "project", id: "p" }], from: "Project.title" }),
    ]);
    expect(ok.text).toBe("a video about carthage");
    expect(inspectQuotation({ ...ok, textOrigin: "template_filled" }).status).toBe("verified");
  });

  test("the metric-key scan is unchanged: a market metric still cannot exist at any depth", () => {
    const pkg = buildPublishingPackage(bannedWordSource(), OPTS);
    const withMetric = structuredClone(pkg) as unknown as { keywords: { buckets: { keywords: Record<string, unknown>[] }[] } };
    withMetric.keywords.buckets[0].keywords[0].searchVolume = 8100;
    const result = auditPublishingPackage(withMetric);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "forbidden_metric_key")).toBe(true);
  });

  test("BANNED_CLAIMS itself is not weakened: every phrase still bites in app-authored text", () => {
    for (const phrase of BANNED_CLAIMS) {
      const ours = {
        note: {
          state: "derived",
          value: `This app says ${phrase}.`,
          rule: "R-PINNED-COMMENT",
          sources: [{ kind: "project", id: "p" }],
          textOrigin: "rule_authored",
        },
      };
      const result = auditPublishingPackage(ours);
      expect(result.ok, `"${phrase}" was not caught`).toBe(false);
    }
  });

  test("the protected invariant stays green: a claim in a TEMPLATE fails, the project's own words do not", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const withClaim = structuredClone(pkg) as unknown as typeof pkg;
    withClaim.titles.titles[0].templateText = "Guaranteed viral growth for your channel";
    expect(auditPublishingPackage(withClaim).ok).toBe(false);
    expect(() => buildPublishingPackage(bannedWordSource(), OPTS)).not.toThrow();
    expect(() => buildPublishingPackage(richSource(), OPTS)).not.toThrow();
    expect(() => auditPublishingPackage({ pinnedComment: { state: "derived" } })).not.toThrow(PublishingHonestyError);
  });
});

/**
 * Phase 7 Block 3b (follow-up #3, item 1) — THE SAME PROJECT, ONE LEVEL UP.
 *
 * The package could already be built for a project whose own text carries every
 * banned word. The Creator Studio VIEW could not: it carried the project's title as
 * a bare string, the audit read it as a sentence THIS APP wrote, and the page for
 * such a project rendered nothing at all (`projectTitle (banned_claim)`). The title
 * is now a declared quotation, like every other quoted value, so the view builds,
 * audits ok, and its title renders as the project's own characters.
 */
describe("P7-3b follow-up #3 — the Creator Studio view of a project whose own text is on the banned list", () => {
  function viewOfBannedProject() {
    const source = bannedWordSource();
    const pkg = buildPublishingPackage(source, OPTS);
    const view = buildCreatorStudioView({
      projectId: source.project.id,
      package: pkg,
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 4096,
      versions: [],
      reAudit: auditPublishingPackage(pkg, { now: NOW }),
    });
    return { source, pkg, view };
  }
  test("the view builds and its own audit says ok", () => {
    const { view } = viewOfBannedProject();
    expect(view.kind).toBe("package");
    const audit = auditPublishingPackage(view, { now: NOW });
    expect(audit.ok, JSON.stringify(audit.violations)).toBe(true);
    expect(audit.violationCount).toBe(0);
    expect(audit.quotedSentences).toBeGreaterThan(0);
  });
  test("the title is carried as the project's own characters, attributed to the row it came from", () => {
    const { source, view } = viewOfBannedProject();
    if (view.kind !== "package") throw new Error("expected a package view");
    const title = view.projectTitle;
    expect(title.state).toBe("derived");
    expect(title.textOrigin).toBe("template_filled");
    expect(title.value).toBe(source.project.title);
    expect(title.fragments?.length).toBe(1);
    expect(title.fragments?.[0].text).toBe(source.project.title);
    expect(title.fragments?.[0].sources).toEqual([{ kind: "project", id: source.project.id, path: "title" }]);
    // Every character of the rendered title is a quoted fragment; none is this
    // app's own wording.
    const segments = quotedSegments(title);
    expect(segments).not.toBeNull();
    expect(quotedCharacters(segments!)).toEqual([source.project.title]);
    expect(segments!.every((segment) => segment.quoted)).toBe(true);
    expect(title.templateText).toBe("{PROJECT_TITLE}");
  });
  test("a project with no saved package still gets its title, the same way", () => {
    const source = bannedWordSource();
    const empty = buildEmptyCreatorStudioView({
      projectId: source.project.id,
      projectTitle: source.project.title,
      versions: [],
    });
    expect(empty.kind).toBe("empty");
    if (empty.kind !== "empty") return;
    expect(auditPublishingPackage(empty, { now: NOW }).ok).toBe(true);
    expect(quotedCharacters(quotedSegments(empty.projectTitle)!)).toEqual([source.project.title]);
  });
});

/**
 * P7-4 FOLLOW-UP D — THE SAME FIX, FOR THE OTHER SHAPE, ON EVERY SURFACE.
 *
 * The defect, found by the unmarked-occurrence probe on the served build: three
 * values in the thumbnails section of a project titled with banned words rendered
 * the project's own title as a plain unmarked span (`data-quoted="false"`),
 * labelled Overlay text (×2) and Dominant subject. Their origin is
 * `source_verbatim` — the value IS the project's title, copied whole — and
 * `quotedSegments` used to answer only for `template_filled`. So the project's own
 * words were reprinted as though this app had written them, one section away from
 * the Package section, where the same characters render with the chip and the
 * note that say whose they are.
 *
 * What is held here: every whole-copy value on the page is marked, the marking
 * covers all of it, the sibling surfaces (the keyword lists) are marked too, the
 * audit still passes, and a banned claim THIS APP writes still fails.
 */
describe("P7-4 follow-up D — a value that is a copy of a project row renders as the project's own", () => {
  function viewOfBannedProject() {
    const source = bannedWordSource();
    const pkg = buildPublishingPackage(source, OPTS);
    const view = buildCreatorStudioView({
      projectId: source.project.id,
      package: pkg,
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 4096,
      versions: [],
      reAudit: auditPublishingPackage(pkg, { now: NOW }),
    });
    if (view.kind !== "package") throw new Error("expected a package view");
    return { source, pkg, view };
  }
  /** Every value the page would render, with the path it sits at. */
  function allValues(view: { sections: { id: string; values: unknown[]; rows: unknown[] }[] }) {
    const out: { section: string; label: string; value: StudioValue }[] = [];
    type Row = { label: string; values: StudioValue[]; children?: Row[] };
    const walkRows = (section: string, rows: Row[]) => {
      for (const row of rows) {
        for (const value of row.values) out.push({ section, label: `${row.label} · ${value.label}`, value });
        walkRows(section, row.children ?? []);
      }
    };
    for (const section of view.sections as unknown as {
      id: string;
      values: StudioValue[];
      rows: Row[];
    }[]) {
      for (const value of section.values) out.push({ section: section.id, label: value.label, value });
      walkRows(section.id, section.rows);
    }
    return out;
  }
  test("every whole-copy value on the page is marked as the project's own — all of it, none of it left unmarked", () => {
    const { view } = viewOfBannedProject();
    const values = allValues(view);
    const copies = values.filter(
      (entry) =>
        entry.value.state === "derived" &&
        (entry.value.textOrigin === "source_verbatim" || entry.value.textOrigin === "provider_verbatim") &&
        typeof entry.value.value === "string" &&
        entry.value.value.length > 0,
    );
    // The sweep is not vacuous: this project's page carries a large number of
    // whole copies, and every one of them must be marked.
    expect(copies.length).toBeGreaterThan(20);
    const unmarked = copies.filter((entry) => quotedSegments(entry.value) === null);
    expect(unmarked.map((entry) => `${entry.section} · ${entry.label}`)).toEqual([]);
    for (const entry of copies) {
      const segments = quotedSegments(entry.value)!;
      // Marked IN FULL: a whole-value copy has no unmarked remainder, because the
      // app's own template for it is the placeholder alone.
      expect(segments.every((segment) => segment.quoted)).toBe(true);
      expect(segments.map((segment) => segment.text).join("")).toBe(entry.value.value as string);
    }
    // The three values the live probe caught, by the labels the page shows.
    const thumbnails = copies.filter((entry) => entry.section === "thumbnails");
    const overlay = thumbnails.filter((entry) => entry.label.endsWith("Overlay text"));
    const subject = thumbnails.filter((entry) => entry.label.endsWith("Dominant subject"));
    expect(overlay.length).toBeGreaterThan(0);
    expect(subject.length).toBeGreaterThan(0);
    for (const entry of [...overlay, ...subject]) {
      expect(quotedSegments(entry.value)).not.toBeNull();
    }
    // …and at least one of them is the project's own title, character for
    // character: the exact text the probe found printed unmarked.
    expect([...overlay, ...subject].some((entry) => entry.value.value === view.projectTitle.value)).toBe(true);
  });
  test("the keyword lists are marked too — the sibling surface the thumbnails fix did not cover", () => {
    const { view } = viewOfBannedProject();
    const keywords = view.sections.find((section) => section.id === "keywords");
    expect(keywords).toBeDefined();
    const items = keywords!.groups.flatMap((group) => group.items);
    expect(items.length).toBeGreaterThan(0);
    const unmarked = items.filter((item) => quotedSegments(item) === null);
    expect(unmarked.map((item) => item.id)).toEqual([]);
    for (const item of items) {
      const segments = quotedSegments(item)!;
      // The phrase is the project's own characters in full, so the marking covers
      // the whole phrase and the declaration names the row it was read from.
      expect(segments.map((segment) => segment.text).join("")).toBe(item.value);
      expect(segments.every((segment) => segment.quoted)).toBe(true);
      expect(item.templateText).toBe(WHOLE_VALUE_PLACEHOLDER);
      expect(item.fragments[0].sources.length).toBeGreaterThan(0);
      expect(item.fragments[0].textOrigin).toBe("source_verbatim");
    }
    // Every group whose items are copies of the project's phrases reports them
    // marked, so the surface can say so once per list.
    expect(keywords!.groups.every((group) => group.items.every((item) => quotedSegments(item) !== null))).toBe(true);
  });
  test("the view's own honesty audit still says ok with every whole-copy declaration attached", () => {
    const { view } = viewOfBannedProject();
    const audit = auditPublishingPackage(view, { now: NOW });
    expect(audit.ok, JSON.stringify(audit.violations)).toBe(true);
    expect(audit.violationCount).toBe(0);
    // The declarations added here are NOT counted as quotations: a whole copy
    // declares `source_verbatim`, which is the declaration the audit already
    // exempts it by (see `copiedText` in ../audit). Nothing about what the audit
    // scans has changed — it exempts the same values it exempted before.
    expect(audit.unverifiedTemplateFills).toBe(0);
    // The check still ran: the walk inspected real keys and strings.
    expect(audit.inspectedKeys).toBeGreaterThan(1000);
  });
  test("a banned claim THIS APP writes still fails, on the page that now carries the whole-copy declarations", () => {
    const { view } = viewOfBannedProject();
    const withClaim = structuredClone(view) as unknown as typeof view;
    const target = withClaim.sections.find((section) => section.id === "thumbnails")!;
    const authored = target.values.find((value) => value.textOrigin === "rule_authored")!;
    authored.value = "This concept is guaranteed to rank higher than the others.";
    const result = auditPublishingPackage(withClaim, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.some((violation) => violation.kind === "banned_claim")).toBe(true);
    // The teeth are unchanged elsewhere in the same page: the project's own words
    // in the copies above are still exempt, and only the app's sentence fails.
    expect(result.violations.every((violation) => violation.kind === "banned_claim")).toBe(true);
    expect(result.violations.length).toBe(1);
  });
  test("the whole-copy mechanism cannot hide a claim: an unquotable copy declares nothing and prints nothing", () => {
    // A copy with no row to attribute it to gets no declaration, and a derived
    // value with no source row is refused outright by the audit — so the page
    // renders the failure state and the value is never reprinted. Here the far
    // end of that: the declaration itself is empty and nothing is marked.
    expect(wholeValueDeclaration({ text: "the project's own phrase", sources: [], textOrigin: "source_verbatim" })).toEqual({
      templateText: null,
      fragments: [],
    });
    const unattributable = studioValue(
      "Overlay text",
      derived("the project's own phrase", "R-THUMB-TEXT", [{ kind: "project", id: "p" }], { textOrigin: "source_verbatim" }),
    );
    // …while a copy that CAN attribute itself is declared and marked.
    expect(quotedSegments(unattributable)).not.toBeNull();
  });
});
