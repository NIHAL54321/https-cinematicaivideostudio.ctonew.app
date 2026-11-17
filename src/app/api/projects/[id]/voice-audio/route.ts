/**
 * GET /api/projects/[id]/voice-audio
 * Phase 8 Audio/Subtitle/Thumbnail block, Block B, 2026-11-15.
 *
 * The Voice & Audio tab's payload: the voice catalogue (with the count of entries
 * whose `providerVoiceId` is null), the env var names the AI status module derives
 * for `voice_generation`, the music/ducking/sfx PLANS for this project, and what
 * the delivered file's audio track actually is — read from the job's own
 * `container-mux` stage output.
 *
 * Ownership: `projectSceneSource` resolves the project through `getOwnedProject`,
 * so another account's project is a 404 and never someone else's audio facts.
 *
 * There is no POST here: nothing on this panel produces audio, because no
 * text-to-speech, music or sound-effects provider is wired on this deployment.
 */
import { apiError, ok, requireApiUser } from "@/lib/api";
import { loadVoiceAudioView } from "@/lib/studio/voice-audio-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const view = await loadVoiceAudioView({ userId, projectId: id });
    return ok(view);
  } catch (err) {
    return apiError(err);
  }
}
