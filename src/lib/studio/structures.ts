/**
 * Story structures — the deterministic skeleton library behind the Script
 * engine. Every structure is a typed array of beats (name + purpose + weight).
 * These are STRUCTURES, not AI-written copy: beats describe what each section
 * is FOR, never the actual script text.
 */
import type { StoryStructure, VideoFormat } from "./types";

export const STRUCTURES: StoryStructure[] = [
  {
    id: "hook-problem-solution",
    name: "Hook → Problem → Solution",
    description:
      "Open with a hook, surface a real problem, explain it with evidence and an example, then resolve it. The workhorse for explainers and how-to content.",
    suitedFor: ["LONG", "SHORT"],
    keywords: ["problem", "solve", "solution", "fix", "how to", "trouble", "issue", "pain", "best way", "explain"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Grab attention in the first seconds and open a curiosity loop.", share: 0.12, role: "hook" },
      { id: "problem", name: "Problem", purpose: "Name the problem the viewer recognizes.", share: 0.12, role: "body" },
      { id: "explanation", name: "Explanation", purpose: "Explain why the problem exists and how it works.", share: 0.18, role: "body" },
      { id: "evidence", name: "Evidence", purpose: "Support the explanation with real examples or sourced data.", share: 0.16, role: "body" },
      { id: "example", name: "Example", purpose: "Ground it in one concrete, relatable case.", share: 0.14, role: "body" },
      { id: "solution", name: "Solution", purpose: "Present the actionable answer.", share: 0.16, role: "body" },
      { id: "conclusion", name: "Conclusion", purpose: "Summarize and point to the next step.", share: 0.12, role: "ending" },
    ],
  },
  {
    id: "hook-story-conflict",
    name: "Hook → Story → Conflict → Discovery → Resolution",
    description:
      "A narrative arc: open with a hook, tell a story, raise a conflict, land on a discovery, resolve. Best for storytelling and case studies.",
    suitedFor: ["LONG", "SHORT"],
    keywords: ["story", "tale", "experience", "how i", "journey of", "founding", "case study", "turned"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Tease the outcome so the viewer stays for the story.", share: 0.12, role: "hook" },
      { id: "story", name: "Story", purpose: "Begin the narrative with scene and stakes.", share: 0.22, role: "body" },
      { id: "conflict", name: "Conflict", purpose: "Introduce the obstacle that drives tension.", share: 0.2, role: "body" },
      { id: "discovery", name: "Discovery", purpose: "The insight or turning point the story builds toward.", share: 0.22, role: "body" },
      { id: "resolution", name: "Resolution", purpose: "Close the arc and state what changed.", share: 0.24, role: "ending" },
    ],
  },
  {
    id: "problem-solution",
    name: "Problem → Solution (classic)",
    description: "Direct persuasion: problem, pain, then the solution and its benefits. Best for product explainers and tutorials.",
    suitedFor: ["LONG", "SOCIAL"],
    keywords: ["pain", "struggle", "frustrat", "solution", "works", "benefit", "use case"],
    beats: [
      { id: "hook", name: "Hook", purpose: "State the promise: a real problem can be fixed.", share: 0.1, role: "hook" },
      { id: "problem", name: "Problem", purpose: "Describe the problem precisely.", share: 0.14, role: "body" },
      { id: "pain-points", name: "Pain Points", purpose: "Make the cost of not fixing it tangible.", share: 0.16, role: "body" },
      { id: "solution", name: "Solution", purpose: "Introduce the answer.", share: 0.16, role: "body" },
      { id: "how-it-works", name: "How It Works", purpose: "Walk through the mechanics step by step.", share: 0.2, role: "body" },
      { id: "benefits", name: "Benefits", purpose: "Show the outcome of using it.", share: 0.14, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Tell the viewer exactly what to do next.", share: 0.1, role: "ending" },
    ],
  },
  {
    id: "listicle",
    name: "Listicle / Top-N",
    description: "A ranked list with context, payoff items and a recap. Best for 'top N', 'ways', 'tips' content.",
    suitedFor: ["SOCIAL", "SHORT"],
    keywords: ["top", "best", "ways", "tips", "reasons", "ideas", "hacks", "things", "list", "ranking"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Promise the list and hint at the #1 payoff.", share: 0.1, role: "hook" },
      { id: "context", name: "Context", purpose: "Set criteria: why these items, in this order.", share: 0.14, role: "body" },
      { id: "items", name: "The List", purpose: "Each item gets its own beat-sized treatment.", share: 0.5, role: "body" },
      { id: "recap", name: "Recap", purpose: "Re-anchor the ranking in memory.", share: 0.16, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Invite a comment or save.", share: 0.1, role: "ending" },
    ],
  },
  {
    id: "timeline",
    name: "Timeline / Chronological",
    description: "Events in order, a turning point, and what it means now. Best for history, evolution and origin stories.",
    suitedFor: ["LONG"],
    keywords: ["history", "timeline", "evolution", "story of", "rise", "fall", "decade", "origin", "over the years", "then", "now"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Show how far things have come — tease the turning point.", share: 0.1, role: "hook" },
      { id: "context", name: "Context", purpose: "Set the starting era and baseline.", share: 0.16, role: "body" },
      { id: "timeline", name: "Timeline", purpose: "Walk the key moments in chronological order.", share: 0.38, role: "body" },
      { id: "turning-point", name: "Turning Point", purpose: "The single event that changed the course.", share: 0.18, role: "body" },
      { id: "implication", name: "Implication", purpose: "What the timeline means today.", share: 0.1, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Invite the viewer to follow the series.", share: 0.08, role: "ending" },
    ],
  },
  {
    id: "mystery",
    name: "Mystery",
    description: "Setup, clues, a twist, then the reveal. Best for true-crime, secrets and 'what really happened'.",
    suitedFor: ["SHORT", "SOCIAL"],
    keywords: ["mystery", "secret", "hidden", "truth", "why", "conspiracy", "reveal", "expose", "unsolved", "nobody"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Present the question that must be answered.", share: 0.12, role: "hook" },
      { id: "setup", name: "Setup", purpose: "Establish the scene and the stakes.", share: 0.16, role: "body" },
      { id: "clues", name: "Clues", purpose: "Lay out the evidence piece by piece.", share: 0.24, role: "body" },
      { id: "twist", name: "Twist", purpose: "The detail that reframes everything.", share: 0.16, role: "body" },
      { id: "reveal", name: "Reveal", purpose: "The answer, fully formed.", share: 0.18, role: "body" },
      { id: "implication", name: "Implication", purpose: "What the reveal changes.", share: 0.08, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Invite engagement — 'what do you think?'.", share: 0.06, role: "ending" },
    ],
  },
  {
    id: "journey",
    name: "Journey",
    description: "Start point, obstacles, turning point, destination. Best for travel, transformation and long-form narrative.",
    suitedFor: ["LONG"],
    keywords: ["travel", "journey", "adventure", "trip", "road", "expedition", "trek", "across"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Show the destination to justify the journey.", share: 0.1, role: "hook" },
      { id: "start-point", name: "Start Point", purpose: "Where it all begins.", share: 0.14, role: "body" },
      { id: "obstacles", name: "Obstacles", purpose: "What made it hard.", share: 0.24, role: "body" },
      { id: "turning-point", name: "Turning Point", purpose: "The moment everything shifted.", share: 0.18, role: "body" },
      { id: "destination", name: "Destination", purpose: "Arriving at the goal.", share: 0.16, role: "body" },
      { id: "reflection", name: "Reflection", purpose: "What the journey taught.", share: 0.12, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Send the viewer on their own path.", share: 0.06, role: "ending" },
    ],
  },
  {
    id: "before-after",
    name: "Before / After",
    description: "The before, the struggle, the transformation, the after. Best for results, makeovers and case studies.",
    suitedFor: ["SHORT", "SOCIAL"],
    keywords: ["before", "after", "transform", "change", "result", "makeover", "progress", "difference"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Show the after — earn the before.", share: 0.12, role: "hook" },
      { id: "before", name: "The Before", purpose: "The starting state.", share: 0.16, role: "body" },
      { id: "struggle", name: "The Struggle", purpose: "Why the before was hard to change.", share: 0.18, role: "body" },
      { id: "transformation", name: "The Transformation", purpose: "The process that bridged before → after.", share: 0.22, role: "body" },
      { id: "after", name: "The After", purpose: "The outcome, concrete and felt.", share: 0.16, role: "body" },
      { id: "lessons", name: "Lessons", purpose: "What transfers to the viewer.", share: 0.1, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Invite the viewer to start their own change.", share: 0.06, role: "ending" },
    ],
  },
  {
    id: "question-answer",
    name: "Question → Answer",
    description: "Open with the question, build context, deliver answers, synthesize. Best for Q&A, myths and 'explained' content.",
    suitedFor: ["SHORT", "SOCIAL"],
    keywords: ["what is", "why do", "how does", "explained", "answered", "what happens", "question", "answer", "myth", "fact"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Ask the question the viewer is already thinking.", share: 0.1, role: "hook" },
      { id: "context", name: "Context", purpose: "Why the question matters.", share: 0.14, role: "body" },
      { id: "answers", name: "Answers", purpose: "Address the question from each important angle.", share: 0.44, role: "body" },
      { id: "synthesis", name: "Synthesis", purpose: "Pull the answers into one clear takeaway.", share: 0.18, role: "body" },
      { id: "cta", name: "Call to Action", purpose: "Invite the viewer's follow-up question.", share: 0.14, role: "ending" },
    ],
  },
  {
    id: "monomyth-lite",
    name: "Monomyth-lite",
    description: "Ordinary world, call to adventure, challenges, crisis, transformation, return. Best for epic stories and character arcs.",
    suitedFor: ["LONG"],
    keywords: ["hero", "epic", "character", "arc", "calling", "quest", "legend", "destiny"],
    beats: [
      { id: "hook", name: "Hook", purpose: "Hint at the transformation to come.", share: 0.1, role: "hook" },
      { id: "ordinary-world", name: "Ordinary World", purpose: "The familiar starting state.", share: 0.14, role: "body" },
      { id: "call-to-adventure", name: "Call to Adventure", purpose: "The opportunity that changes everything.", share: 0.14, role: "body" },
      { id: "challenges", name: "Challenges", purpose: "The trials along the way.", share: 0.24, role: "body" },
      { id: "crisis", name: "Crisis", purpose: "The low point that forces growth.", share: 0.16, role: "body" },
      { id: "transformation", name: "Transformation", purpose: "Who they became because of it.", share: 0.14, role: "body" },
      { id: "return", name: "Return", purpose: "Back to the world, changed.", share: 0.08, role: "ending" },
    ],
  },
];

export const DEFAULT_STRUCTURE_ID = "hook-problem-solution";

export function getStructure(id: string): StoryStructure | undefined {
  return STRUCTURES.find((s) => s.id === id);
}

/**
 * Deterministic structure selection heuristics — NOT AI.
 *
 * Scores every structure by (a) video-format affinity and (b) keyword hits in
 * the topic/idea text. Returns the highest-scoring structure with the matched
 * keywords so callers can show why it was chosen. Ties break by array order,
 * so the result is stable for identical inputs.
 */
export function selectStructure(
  videoType: VideoFormat,
  topic: string,
): { structure: StoryStructure; score: number; matchedKeywords: string[] } {
  const text = topic.toLowerCase();
  const matches = new Map<string, Set<string>>();
  const scores = new Map<string, number>();

  for (const s of STRUCTURES) {
    const hits = new Set<string>();
    for (const kw of s.keywords) {
      if (text.includes(kw.toLowerCase())) hits.add(kw);
    }
    matches.set(s.id, hits);
    // Format affinity: +3 for a perfect fit, +1 for a plausible fit.
    const affinity = s.suitedFor.includes(videoType)
      ? videoType === "LONG" && s.suitedFor.length === 1
        ? 3
        : 2
      : 0;
    // Keyword hits are strong signals — each hit outweighs affinity.
    scores.set(s.id, affinity + hits.size * 3);
  }

  // Long-form default leans to the evidence-led Problem → Solution arc;
  // short/social default to Question → Answer (tight loops).
  const defaultId =
    videoType === "LONG" ? DEFAULT_STRUCTURE_ID : videoType === "SHORT" ? "question-answer" : "listicle";
  scores.set(defaultId, (scores.get(defaultId) ?? 0) + 1);

  let best = STRUCTURES[0];
  let bestScore = -1;
  for (const s of STRUCTURES) {
    const sc = scores.get(s.id) ?? 0;
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }

  return {
    structure: best,
    score: bestScore,
    matchedKeywords: [...(matches.get(best.id) ?? [])],
  };
}
