/**
 * GET /api/projects/[id]/subtitles/export?format=srt|vtt&style=<catalog id>
 * Phase 8 Audio/Subtitle/Thumbnail block, 2026-11-15.
 *
 * The Subtitles tab's download. The bytes are produced HERE, on the server, from
 * the project's own Scene rows through the subtitle engine — never from a string
 * the browser built, and never from the panel's cached copy. It is the same
 * derivation the `subtitles` `generate` action answers with, so the file and the
 * cue list on screen cannot disagree.
 *
 * Ownership: `projectSceneSource` resolves the project through getOwnedProject,
 * so another account's project is a 404 — never someone else's captions.
 *
 * 422 when the project has no cue to export (no scenes, or no scene carrying
 * narration). No empty file is served to look like a success.
 *
 * What this file is NOT: a burned-in subtitle track. No delivered video carries
 * one; this is the caption file on its own.
 */
import type { NextRequest } from "next/server";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { contentDisposition } from "@/lib/downloads/serve";
import { SUBTITLE_STYLES, toSrt, toVtt } from "@/lib/subtitles";
import { deriveSceneSubtitles } from "@/lib/subtitles/from-scenes";
import { projectSceneSource } from "@/lib/subtitles/scene-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A plain-ASCII filename stem: the project's title, so the file names its project. */
function fileStem(title: string): string {
  const slug = (title || "project")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "project";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;

    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "srt").toLowerCase();
    if (format !== "srt" && format !== "vtt") {
      return ok({ error: "Unsupported format.", note: "Expected format=srt or format=vtt." }, 400);
    }
    const styleParam = url.searchParams.get("style") ?? "minimal";
    const style = SUBTITLE_STYLES.find((s) => s.id === styleParam);
    if (!style) {
      return ok(
        {
          error: "Unknown style.",
          note: `Expected one of the catalog ids: ${SUBTITLE_STYLES.map((s) => s.id).join(", ")}.`,
        },
        400,
      );
    }

    const source = await projectSceneSource(userId, id);
    const derived = deriveSceneSubtitles(source.scenes, {
      style: style.id,
      ...(url.searchParams.get("language") ? { language: url.searchParams.get("language") as string } : {}),
    });

    if (derived.empty) {
      return ok(
        {
          error: "Nothing to export.",
          message: derived.emptyReason,
          cueCount: 0,
          sceneCount: source.scenes.length,
        },
        422,
      );
    }

    const body = format === "srt" ? toSrt(derived.plan) : toVtt(derived.plan);
    const filename = `${fileStem(source.projectTitle)}-${derived.style.id}.${format}`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
        "content-disposition": contentDisposition(filename),
        "cache-control": "private, no-store",
        "content-length": String(Buffer.byteLength(body, "utf8")),
        "x-cue-count": String(derived.cueCount),
        "x-timing-basis": derived.timingBasis,
        "x-subtitle-source": "project-scenes",
        "x-subtitles-burned-in": "false",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
