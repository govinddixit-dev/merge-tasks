/**
 * Voice transcription helper — local dev version using OpenAI Whisper API directly.
 */

export type TranscribeOptions = {
  audioUrl: string;
  language?: string;
  prompt?: string;
};

export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse;

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };
  return mimeToExt[mimeType] || "mp3";
}

function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    en: "English", es: "Spanish", fr: "French", de: "German",
    it: "Italian", pt: "Portuguese", ru: "Russian", ja: "Japanese",
    ko: "Korean", zh: "Chinese", ar: "Arabic", hi: "Hindi",
    nl: "Dutch", pl: "Polish", tr: "Turkish", sv: "Swedish",
    da: "Danish", no: "Norwegian", fi: "Finnish",
  };
  return langMap[langCode] || langCode;
}

export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  // Prefer APP_OPENAI_API_KEY from .env over system-level stub
  const { ENV } = await import("./env");
  const apiKey = ENV.appOpenAiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      error: "Voice transcription service is not configured",
      code: "SERVICE_ERROR",
      details: "OPENAI_API_KEY is not set",
    };
  }

  try {
    // Download audio from URL
    const response = await fetch(options.audioUrl);
    if (!response.ok) {
      return {
        error: "Failed to download audio file",
        code: "INVALID_FORMAT",
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") || "audio/mpeg";

    const sizeMB = audioBuffer.length / (1024 * 1024);
    if (sizeMB > 25) {
      return {
        error: "Audio file exceeds maximum size limit",
        code: "FILE_TOO_LARGE",
        details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 25MB`,
      };
    }

    const { FormData, Blob } = await import("formdata-node");
    const form = new FormData();
    const filename = `audio.${getFileExtension(mimeType)}`;
    form.set("file", new Blob([audioBuffer], { type: mimeType }), filename);
    form.set("model", "whisper-1");
    form.set("response_format", "verbose_json");

    const prompt =
      options.prompt ||
      (options.language
        ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
        : "Transcribe the user's voice to text");
    form.set("prompt", prompt);

    if (options.language) {
      form.set("language", options.language);
    }

    const transcribeResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form as unknown as BodyInit,
      }
    );

    if (!transcribeResponse.ok) {
      const errorText = await transcribeResponse.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${transcribeResponse.status} ${transcribeResponse.statusText}${errorText ? `: ${errorText}` : ""}`,
      };
    }

    const whisperResponse = (await transcribeResponse.json()) as WhisperResponse;

    if (!whisperResponse.text || typeof whisperResponse.text !== "string") {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format",
      };
    }

    return whisperResponse;
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}
