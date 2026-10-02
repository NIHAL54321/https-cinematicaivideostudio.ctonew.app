/**
 * Deterministic candidate ranking for stock search results.
 *
 * Combines provider relevance (score) with a small keyword-overlap boost
 * against the semantic query's subject/emotion terms. Pure, deterministic,
 * no AI. Result is ordered best-first.
 */
import type { ProviderAsset } from "./types";
import type { SemanticQuery } from "./semantic";

/** 0–1 relevance: provider score blended with keyword overlap. */
export function rankCandidates(candidates: ProviderAsset[], query: SemanticQuery): ProviderAsset[] {
  const subjectTerms = new Set(query.subject.map((t) => t.toLowerCase()));
  const allTerms = new Set(
    [...query.subject, ...query.emotion, ...query.location].map((t) => t.toLowerCase()),
  );
  return [...candidates]
    .map((c) => {
      const hay = `${c.title} ${c.author}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      let subjectHits = 0;
      let allHits = 0;
      for (const w of hay) {
        if (subjectTerms.has(w)) subjectHits++;
        if (allTerms.has(w)) allHits++;
      }
      const base = c.score ?? 0.5;
      // Deterministic blend: provider relevance (60%) + term overlap (40%).
      const overlap = Math.min(1, allHits / Math.max(1, allTerms.size));
      const score = Math.round((base * 0.6 + overlap * 0.4) * 1000) / 1000;
      return { candidate: c, score, subjectHits };
    })
    .sort((a, b) => b.score - a.score || b.subjectHits - a.subjectHits)
    .map(({ candidate, score }) => ({ ...candidate, score }));
}
