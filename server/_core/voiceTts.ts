/**
 * Text-to-Speech helper using OpenAI TTS API.
 * Returns audio as a base64-encoded MP3 string.
 */
export type TtsOptions = {
  text: string;
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  speed?: number; // 0.25 to 4.0, default 1.0
};

export type TtsResult =
  | { audioBase64: string; mimeType: "audio/mpeg" }
  | { error: string };

export async function synthesizeSpeech(options: TtsOptions): Promise<TtsResult> {
  const { ENV } = await import("./env");
  const apiKey = ENV.appOpenAiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { error: "TTS service is not configured: OPENAI_API_KEY is not set" };
  }

  // Truncate very long text to avoid excessive TTS costs (max ~4000 chars)
  const text = options.text.slice(0, 4000);
  if (!text.trim()) {
    return { error: "No text provided" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: options.voice ?? "nova",
        speed: options.speed ?? 1.0,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { error: `TTS API error ${response.status}: ${errText}` };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      audioBase64: audioBuffer.toString("base64"),
      mimeType: "audio/mpeg",
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "TTS synthesis failed",
    };
  }
}
