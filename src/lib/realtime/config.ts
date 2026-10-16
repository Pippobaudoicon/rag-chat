// Web voice prototype (flag NEXT_PUBLIC_REALTIME_VOICE=1). Client-safe: next.config.ts
// inlines REALTIME_MODEL so the browser can build the matching model codec.

export const REALTIME_VOICE_ENABLED = process.env.NEXT_PUBLIC_REALTIME_VOICE === "1";
export const REALTIME_MODEL = process.env.REALTIME_MODEL || "openai/gpt-realtime-mini";

export const voiceSessionConfig = {
  instructions: `You are ChatLDS, a spoken assistant for The Church of Jesus Christ of Latter-day Saints.
Reply in the language the user speaks.
For any gospel, doctrinal or factual question, call semantic_search FIRST and answer only from its results.
Name sources aloud briefly, e.g. "In Alma 32..." or "Elder X, April 2024...".
Answer in 2-4 short sentences unless asked for more. If nothing relevant is found, say so.`,
  voice: "alloy",
  inputAudioTranscription: {},
  turnDetection: { type: "server-vad" as const },
};
