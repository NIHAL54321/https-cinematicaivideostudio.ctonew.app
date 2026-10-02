/**
 * The 24 video content types (spec) that the AI Script Writer studio accepts.
 *
 * Pure data — descriptors only. Each type suggests a sensible video format
 * (LONG / SHORT / SOCIAL) which is used as a hint when deriving structure; the
 * studio still derives the actual format from the chosen duration. None of this
 * is AI output.
 */
import type { VideoFormat } from "./types";

export interface VideoTypeOption {
  id: string;
  name: string;
  description: string;
  /** Hint for the shape of video this content category usually lives in. */
  formatHint: VideoFormat;
}

export const VIDEO_TYPES: VideoTypeOption[] = [
  { id: "documentary", name: "Documentary", description: "Observational, factual deep-dive into a real subject.", formatHint: "LONG" },
  { id: "educational", name: "Educational", description: "Structured teaching with clear explanations.", formatHint: "LONG" },
  { id: "financial", name: "Financial", description: "Money, investing, markets and personal finance.", formatHint: "LONG" },
  { id: "motivation", name: "Motivation", description: "Uplifting, momentum-building short-form inspiration.", formatHint: "SHORT" },
  { id: "self-improvement", name: "Self-improvement", description: "Habits, growth and personal development.", formatHint: "LONG" },
  { id: "travel", name: "Travel", description: "Places, journeys and destination storytelling.", formatHint: "LONG" },
  { id: "technology", name: "Technology", description: "Gadgets, software, AI and the digital world.", formatHint: "LONG" },
  { id: "history", name: "History", description: "Events, eras and figures from the past.", formatHint: "LONG" },
  { id: "science", name: "Science", description: "Discovery, explanation and how the world works.", formatHint: "LONG" },
  { id: "business", name: "Business", description: "Companies, markets, strategy and entrepreneurship.", formatHint: "LONG" },
  { id: "news", name: "News", description: "Current events and timely analysis.", formatHint: "SOCIAL" },
  { id: "storytelling", name: "Storytelling", description: "Narrative-first, emotionally driven pieces.", formatHint: "LONG" },
  { id: "luxury", name: "Luxury", description: "Premium products, brands and high-end lifestyle.", formatHint: "SOCIAL" },
  { id: "lifestyle", name: "Lifestyle", description: "Daily life, routines, fashion and wellbeing.", formatHint: "SHORT" },
  { id: "product-review", name: "Product review", description: "Hands-on evaluation of a specific product.", formatHint: "SHORT" },
  { id: "explainer", name: "Explainer", description: "Simplifies a concept into a clear, short answer.", formatHint: "SHORT" },
  { id: "listicle", name: "Listicle", description: "A ranked/enumerated set of items or ideas.", formatHint: "SOCIAL" },
  { id: "top-10", name: "Top 10", description: "A countdown of the best or worst of something.", formatHint: "SOCIAL" },
  { id: "biography", name: "Biography", description: "A person's life and legacy in narrative form.", formatHint: "LONG" },
  { id: "mystery", name: "Mystery", description: "Secrets, crimes and unsolved questions.", formatHint: "LONG" },
  { id: "true-story", name: "True-story style", description: "A real event retold with narrative stakes.", formatHint: "LONG" },
  { id: "nature", name: "Nature", description: "Wildlife, environments and the natural world.", formatHint: "LONG" },
  { id: "corporate", name: "Corporate", description: "Brand, product and company communications.", formatHint: "LONG" },
  { id: "infographic", name: "Infographic", description: "Data-led visual storytelling.", formatHint: "SOCIAL" },
];

export function getVideoType(id: string | undefined | null): VideoTypeOption | undefined {
  if (!id) return undefined;
  return VIDEO_TYPES.find((t) => t.id === id);
}

export function videoTypeByIdOrFirst(id: string | undefined | null): VideoTypeOption {
  return getVideoType(id) ?? VIDEO_TYPES[0];
}
