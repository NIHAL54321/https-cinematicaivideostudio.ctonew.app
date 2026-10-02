/**
 * Phase 4 — Pronunciation engine (deterministic, pure, no IO).
 *
 * Makes raw script text TTS-friendly:
 *  - wordToPhoneticHint: known tokens (proper names, companies, currencies,
 *    numbers, dates) → phonetic/instruction hint; unknown → null.
 *  - normalizeSpokenText: expand abbreviations, speak numbers / currency /
 *    percentages / dates, apply user corrections last.
 *  - buildPronunciationLexicon + validatePronunciations: provider lexicon
 *    entries + manual-correction validation.
 */

export interface LexiconEntry {
  token: string;
  phoneticHint: string;
}

export interface CorrectionIssue {
  token: string;
  phoneticHint: string;
  error: string;
}

/** Small curated hint table for well-known tokens. */
const HINT_TABLE: Record<string, string> = {
  nasa: "pronounce letter by letter: N.A.S.A.",
  elon: "EE-lon",
  musk: "musk (rhymes with tusk)",
  tesla: "TESS-luh",
  spacex: "space-eks",
  openai: "open-A-I",
  chatgpt: "chat-G-P-T",
  "s&p 500": "S and P five hundred",
  "s&p": "S and P",
  ftse: "FOOT-see",
  nasdaq: "NAZ-dak",
  eurozone: "YUR-oh-zone",
  tesla_model_s: "Tesla Model Ess",
  iphone: "EYE-fone",
  macbook: "MACK-book",
  android: "AN-droyd",
  google: "GOO-gull",
  youtube: "YOO-toob",
  copernicus: "koh-PURR-nih-kuss",
  darwin: "DAR-win",
  einstein: "EYEN-styne",
  tesla_unit: "TESS-luh (unit: TESS-luh)",
  dna: "pronounce letter by letter: D.N.A.",
  rna: "pronounce letter by letter: R.N.A.",
  ai: "pronounce letter by letter: A.I.",
  ceo: "pronounce letter by letter: C.E.O.",
  faq: "pronounce letter by letter: F.A.Q.",
  gif: "jiff (soft g)",
  jpeg: "JAY-peg",
  sql: "SEE-kwull",
  api: "pronounce letter by letter: A.P.I.",
  url: "pronounce letter by letter: U.R.L.",
  html: "pronounce letter by letter: H.T.M.L.",
  css: "pronounce letter by letter: C.S.S.",
  gpu: "pronounce letter by letter: G.P.U.",
  cpu: "pronounce letter by letter: C.P.U.",
};

const CURRENCY_SYMBOLS: Record<string, { singular: string; plural: string }> = {
  $: { singular: "dollar", plural: "dollars" },
  "€": { singular: "euro", plural: "euros" },
  "£": { singular: "pound", plural: "pounds" },
  "¥": { singular: "yen", plural: "yen" },
  "₹": { singular: "rupee", plural: "rupees" },
};

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], "hundred");
    n %= 100;
    if (n === 0) return parts.join(" ");
  }
  if (n >= 20) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    parts.push(r === 0 ? t : `${t} ${ONES[r]}`);
  } else if (n > 0 || parts.length === 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** Integer (0..999,999,999) → words. Deterministic. */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${numberToWords(-n)}`;
  const int = Math.trunc(n);
  if (int >= 1_000_000_000) return String(int);
  const parts: string[] = [];
  const push = (value: number, unit: string) => {
    if (value > 0) parts.push(`${underThousand(value)} ${unit}`);
  };
  let rest = int;
  push(Math.floor(rest / 1_000_000), "million");
  rest %= 1_000_000;
  push(Math.floor(rest / 1000), "thousand");
  rest %= 1000;
  if (rest > 0 || parts.length === 0) parts.push(underThousand(rest));
  return parts.join(" ");
}

/** Decimal number → spoken words ("3.14" → "three point one four"). */
function decimalToWords(numStr: string): string {
  const [intPart, fracPart] = numStr.split(".");
  const intWords = numberToWords(Number(intPart.replace(/,/g, "")) || 0);
  if (fracPart === undefined || fracPart === "") return intWords;
  const fracWords = fracPart
    .split("")
    .map((d) => DIGIT_WORDS[Number(d)] ?? d)
    .join(" ");
  return `${intWords} point ${fracWords}`;
}

/** "2024"-style 4-digit years → "twenty twenty four"; others → number words. */
function yearToWords(year: number): string {
  if (year >= 1000 && year <= 2099) {
    const first = Math.floor(year / 100);
    const last = year % 100;
    const firstWords = numberToWords(first);
    const lastWords = last < 10 ? `oh ${ONES[last]}` : last === 0 ? "" : numberToWords(last);
    return lastWords ? `${firstWords} ${lastWords}` : firstWords;
  }
  return numberToWords(year);
}

const ABBREVIATIONS: Record<string, string> = {
  "mr.": "mister",
  "mrs.": "missus",
  "ms.": "miss",
  "dr.": "doctor",
  "st.": "saint",
  "ave.": "avenue",
  "blvd.": "boulevard",
  "rd.": "road",
  "etc.": "et cetera",
  "e.g.": "for example",
  "i.e.": "that is",
  "vs.": "versus",
  "approx.": "approximately",
  "dept.": "department",
  "est.": "established",
  "u.s.": "U.S.",
  "u.k.": "U.K.",
  "u.s.a.": "U.S.A.",
};

function speakMoney(symbol: string, amountStr: string): string {
  const cur = CURRENCY_SYMBOLS[symbol] ?? { singular: "units", plural: "units" };
  const clean = amountStr.replace(/,/g, "");
  const [intRaw, fracRaw] = clean.split(".");
  const intVal = Number(intRaw) || 0;
  const unit = intVal === 1 ? cur.singular : cur.plural;
  let out = `${numberToWords(intVal)} ${unit}`;
  if (fracRaw && Number(fracRaw) > 0) {
    const cents = Number(fracRaw.padEnd(2, "0").slice(0, 2));
    out += ` and ${numberToWords(cents)} cents`;
  }
  return out;
}

/**
 * Known-token phonetic hint. Returns null for unknown words (callers treat
 * null as "no special handling needed"). Also handles common numeric /
 * currency / year shapes generically.
 */
export function wordToPhoneticHint(word: string): string | null {
  const raw = (word ?? "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (HINT_TABLE[key]) return HINT_TABLE[key];
  if (/^\d{4}$/.test(raw)) {
    const y = Number(raw);
    if (y >= 1000 && y <= 2099) return yearToWords(y);
  }
  const money = raw.match(/^([$€£¥₹])([\d,]+(?:\.\d+)?)$/);
  if (money) return speakMoney(money[1], money[2]);
  if (/^[\d,]+%$/.test(raw)) {
    return `${decimalToWords(raw.slice(0, -1).replace(/,/g, ""))} percent`;
  }
  if (/^[\d,]+(?:\.\d+)?$/.test(raw)) return decimalToWords(raw.replace(/,/g, ""));
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
    const [m, d, y] = raw.split("/").map(Number);
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31)
      return y !== undefined && raw.split("/")[2].length === 4
        ? `${months[m - 1]} ${numberToWords(d)}, ${yearToWords(y)}`
        : `${months[m - 1]} ${numberToWords(d)}`;
  }
  return null;
}

export type Corrections = Record<string, string>;

/**
 * Rewrite text for TTS-friendliness. Deterministic. Applies (in order):
 * abbreviations → currency → percentages → comma numbers → decimals →
 * years → user corrections (last, so corrections always win).
 */
export function normalizeSpokenText(text: string, corrections: Corrections = {}): string {
  let out = text ?? "";
  // Abbreviations (case-insensitive whole-token).
  for (const [abbr, spoken] of Object.entries(ABBREVIATIONS)) {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$|[,.!?;:])`, "gi"), `$1${spoken}`);
  }
  // Currency: $1,250 / €10,000 / $99.99
  out = out.replace(/([$€£¥₹])([\d,]+(?:\.\d+)?)/g, (_m, sym: string, amt: string) =>
    speakMoney(sym, amt),
  );
  // Percentages: 10% / 3.5%
  out = out.replace(/([\d,]+(?:\.\d+)?)%/g, (_m, n: string) =>
    `${decimalToWords(n.replace(/,/g, ""))} percent`,
  );
  // Comma-grouped integers: 1,000 / 10,000
  out = out.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => numberToWords(Number(m.replace(/,/g, ""))));
  // Decimals: 3.14
  out = out.replace(/\b\d+\.\d+\b/g, (m) => decimalToWords(m));
  // 4-digit years: 2024 / 1999
  out = out.replace(/\b(1\d{3}|20\d{2})\b/g, (m) => yearToWords(Number(m)));
  // User corrections last (whole-word, case-insensitive).
  for (const [token, preferred] of Object.entries(corrections)) {
    const t = (token ?? "").trim();
    const p = (preferred ?? "").trim();
    if (!t || !p) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), p);
  }
  return out;
}

export interface LexiconBuildInput {
  names?: string[];
  countries?: string[];
  cities?: string[];
  companies?: string[];
  scientific?: string[];
  financial?: string[];
  corrections?: Corrections;
}

/**
 * Build a provider pronunciation-lexicon array from categorized term lists.
 * Known tokens get curated hints; unknown tokens get a generic
 * letter-spelling instruction scaffold the provider lexicon can refine.
 * Corrections override everything.
 */
export function buildPronunciationLexicon(input: LexiconBuildInput = {}): LexiconEntry[] {
  const seen = new Map<string, LexiconEntry>();
  const add = (token: string, category: string) => {
    const t = (token ?? "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    const hint = wordToPhoneticHint(t) ?? `pronounce as written (${category} term: ${t})`;
    seen.set(key, { token: t, phoneticHint: hint });
  };
  for (const n of input.names ?? []) add(n, "proper name");
  for (const n of input.countries ?? []) add(n, "country");
  for (const n of input.cities ?? []) add(n, "city");
  for (const n of input.companies ?? []) add(n, "company");
  for (const n of input.scientific ?? []) add(n, "scientific term");
  for (const n of input.financial ?? []) add(n, "financial term");
  for (const [token, preferred] of Object.entries(input.corrections ?? {})) {
    const t = (token ?? "").trim();
    const p = (preferred ?? "").trim();
    if (!t || !p) continue;
    seen.set(t.toLowerCase(), { token: t, phoneticHint: p });
  }
  return [...seen.values()];
}

/** Validate manual pronunciation corrections. Returns per-row issues (empty = valid). */
export function validatePronunciations(corrections: Corrections): CorrectionIssue[] {
  const issues: CorrectionIssue[] = [];
  for (const [token, phoneticHint] of Object.entries(corrections ?? {})) {
    const t = (token ?? "").trim();
    const p = (phoneticHint ?? "").trim();
    if (!t) {
      issues.push({ token, phoneticHint, error: "Token must not be empty." });
      continue;
    }
    if (!p) {
      issues.push({ token, phoneticHint, error: "Pronunciation must not be empty." });
      continue;
    }
    if (t.length > 80 || p.length > 200) {
      issues.push({ token, phoneticHint, error: "Token or pronunciation is unreasonably long." });
    }
  }
  return issues;
}
