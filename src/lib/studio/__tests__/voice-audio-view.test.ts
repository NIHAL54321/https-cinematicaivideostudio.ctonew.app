/**
 * The Voice & Audio tab's payload, driven with rows only — no database, no
 * provider, no browser. The point of these tests is that the panel's sentences
 * FOLLOW the rows: hand it no narration and it says there is none, hand it a
 * measured audio track and it prints the measured codec, hand it a row that
 * measured nothing and it says so instead of assuming.
 */
import { describe, expect, test } from "bun:test";
import {
  deliveredAudioSentence,
  deriveVoiceAudioView,
  type VoiceAudioInput,
  type VoiceProviderFacts,
} from "../voice-audio-view";
import type { DeliveredVideoRow } from "@/lib/render/production-state";
import type { SceneSource } from "@/lib/subtitles/from-scenes";
import type { VoiceEntry } from "@/lib/voice";

function voice(over: Partial<VoiceEntry> = {}): VoiceEntry {
  return {
    id: "marcus-deep",
    name: "Marcus",
    gender: "male",
    persona: "documentary",
    description: "Deep, authoritative documentary narrator.",
    accent: "American (US)",
    tone: "authoritative",
    recommendedPitch: 0.9,
    recommendedSpeed: 0.95,
    providerVoiceId: null,
    capabilities: ["tts"],
    ...over,
  };
}

function scene(id: string, number: number, over: Partial<SceneSource> = {}): SceneSource {
  return { id, number, title: `Scene ${number}`, narration: null, durationSeconds: 30, ...over };
}

function provider(over: Partial<VoiceProviderFacts> = {}): VoiceProviderFacts {
  return {
    capability: "voice_generation",
    connected: false,
    status: "not_connected",
    requiredEnv: ["OPENAI_API_KEY", "ELEVENLABS_API_KEY"],
    envNote: "Derived note.",
    providers: [
      { id: "openai", name: "OpenAI", configured: false, wired: false },
      { id: "elevenlabs", name: "ElevenLabs", configured: false, wired: false },
    ],
    ...over,
  };
}

function delivered(over: Partial<DeliveredVideoRow> = {}): DeliveredVideoRow {
  return {
    jobId: "job_1",
    projectId: "proj_1",
    projectTitle: "The Project",
    presetId: "youtube-1080p",
    presetLabel: "YouTube 1080p",
    bytes: 118049344,
    sha256: "a".repeat(64),
    createdAt: "2026-11-15T10:00:00.000Z",
    measured: {
      durationSeconds: 120.033,
      widthPx: 1920,
      heightPx: 1080,
      videoCodec: "h264",
      profile: "High",
      level: 40,
      pixelFormat: "yuv420p",
      frameRate: "30/1",
      audioCodec: "aac",
      audioChannels: 2,
      audioSampleRateHz: 48000,
      measuredBy: "ffprobe -v error -show_streams",
    },
    durable: null,
    absences: {
      narration: "none — no text-to-speech provider produced one",
      music: "none — no music provider produced one",
      subtitles: "none burned in",
      screening: null,
      aiGeneration: null,
    },
    ...over,
  };
}

function input(over: Partial<VoiceAudioInput> = {}): VoiceAudioInput {
  return {
    projectId: "proj_1",
    projectTitle: "The Project",
    projectDescription: "A documentary about deep-sea cables.",
    scenes: [scene("s1", 1, { narration: "The cable runs two thousand metres down." })],
    voiceoverRows: 0,
    catalogue: [voice(), voice({ id: "eleanor-classic", name: "Eleanor", persona: "documentary" })],
    personas: ["documentary"],
    provider: provider(),
    delivered: [],
    ...over,
  };
}

describe("the catalogue sentence", () => {
  test("names the null providerVoiceId count and the env vars the API names", () => {
    const view = deriveVoiceAudioView(input());
    expect(view.catalogue.count).toBe(2);
    expect(view.catalogue.providerVoiceIdNullCount).toBe(2);
    expect(view.catalogue.sentence).toContain("No text-to-speech provider is wired");
    expect(view.catalogue.sentence).toContain("2 of them record providerVoiceId null");
    expect(view.catalogue.sentence).toContain("OPENAI_API_KEY or ELEVENLABS_API_KEY");
    expect(view.catalogue.sentence).toContain("no narration can be produced");
  });

  test("says a Voiceover row exists when the project has one, and that none exists when it has none", () => {
    expect(deriveVoiceAudioView(input({ voiceoverRows: 0 })).catalogue.sentence).toContain("no Voiceover row");
    expect(deriveVoiceAudioView(input({ voiceoverRows: 2 })).catalogue.sentence).toContain("2 Voiceover rows");
  });

  test("a mapped providerVoiceId is never counted as null", () => {
    const view = deriveVoiceAudioView(
      input({ catalogue: [voice(), voice({ id: "x", name: "X", providerVoiceId: "provider-voice-1" })] }),
    );
    expect(view.catalogue.providerVoiceIdNullCount).toBe(1);
    expect(view.catalogue.sentence).toContain("1 of them record providerVoiceId null");
  });
});

describe("the plans are plans", () => {
  test("with narration, a music pick, a ducking schedule and an sfx plan all exist", () => {
    const view = deriveVoiceAudioView(input());
    expect(view.plans.sentence).toContain("PLAN");
    expect(view.plans.music.top.categoryId.length).toBeGreaterThan(0);
    expect(view.plans.music.topic).toContain("The Project");
    expect(view.plans.ducking).not.toBeNull();
    expect(view.plans.ducking!.events.length).toBeGreaterThan(0);
    expect(view.plans.duckingMissingReason).toBeNull();
    expect(view.plans.sfx).not.toBeNull();
    expect(view.plans.sfxMissingReason).toBeNull();
    expect(view.plans.scenesWithNarration).toBe(1);
  });

  test("with no narration, there is no ducking schedule and no sfx plan, and both say why", () => {
    const view = deriveVoiceAudioView(input({ scenes: [scene("s1", 1)] }));
    expect(view.plans.ducking).toBeNull();
    expect(view.plans.duckingMissingReason).toContain("No scene in this project carries narration text");
    expect(view.plans.sfx).toBeNull();
    expect(view.plans.sfxMissingReason).toContain("No scene in this project carries narration text");
    expect(view.plans.scenesWithNarration).toBe(0);
  });
});

describe("the delivered file's audio", () => {
  test("with no delivered row, the sentence says no file exists and assumes nothing", () => {
    const view = deriveVoiceAudioView(input({ delivered: [] }));
    expect(view.delivered.exists).toBe(false);
    expect(view.delivered.sentence).toContain("No delivered video exists for this project");
  });

  test("with a measured row, the sentence prints the measured audio track and the recorded absences", () => {
    const view = deriveVoiceAudioView(input({ delivered: [delivered()] }));
    expect(view.delivered.exists).toBe(true);
    expect(view.delivered.files[0].audioCodec).toBe("aac");
    expect(view.delivered.files[0].audioChannels).toBe(2);
    expect(view.delivered.files[0].audioSampleRateHz).toBe(48000);
    expect(view.delivered.sentence).toContain("aac 2 channels at 48,000 Hz");
    expect(view.delivered.sentence).toContain("beside h264 video");
    expect(view.delivered.sentence).toContain("no narration");
    expect(view.delivered.sentence).toContain("no music and sound effects");
  });

  test("a row that recorded no measurement is stated as unmeasured, never defaulted", () => {
    const sentence = deliveredAudioSentence([
      {
        jobId: "job_2",
        presetId: "p",
        presetLabel: "P",
        bytes: 10,
        sha256: "b".repeat(64),
        durationSeconds: null,
        videoCodec: null,
        audioCodec: null,
        audioChannels: null,
        audioSampleRateHz: null,
        measuredBy: null,
        absentNarration: null,
        absentMusic: null,
        absentSubtitles: null,
      },
    ]);
    expect(sentence).toContain("no audio measurement");
    expect(sentence).toContain("does not invent one");
  });
});
