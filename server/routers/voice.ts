import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { transcribeAudio } from "../_core/voiceTranscription";
import { storagePut } from "../storage";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { rateLimited } from "../utils/rateLimitMiddleware";
import { VOICE_LIMIT } from "../utils/rateLimiter";

export const voiceRouter = router({
  /**
   * Upload audio buffer and transcribe it.
   * Frontend sends base64-encoded audio, we upload to S3 then transcribe.
   */
  transcribe: protectedProcedure
    .use(rateLimited("voice.transcribe", VOICE_LIMIT))
    .input(
      z.object({
        audioBase64: z.string(), // base64-encoded audio data
        mimeType: z.string().default("audio/webm"),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 1. Decode base64 to buffer
      const audioBuffer = Buffer.from(input.audioBase64, "base64");

      // Check size (16MB limit)
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Audio file is ${sizeMB.toFixed(1)}MB — maximum is 16MB`,
        });
      }

      // 2. Upload to S3
      const ext = input.mimeType.includes("webm")
        ? "webm"
        : input.mimeType.includes("mp4")
          ? "m4a"
          : "wav";
      const fileKey = `voice/${ctx.user.id}/${nanoid()}.${ext}`;

      let audioUrl: string;
      try {
        const result = await storagePut(fileKey, audioBuffer, input.mimeType);
        audioUrl = result.url;
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to upload audio for transcription",
          cause: err,
        });
      }

      // 3. Transcribe
      const result = await transcribeAudio({
        audioUrl,
        language: input.language,
        prompt:
          "Transcribe this voice command from a promotional products distributor managing their business platform.",
      });

      if ("error" in result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error,
          cause: result,
        });
      }

      return {
        text: result.text,
        language: result.language,
        duration: result.duration,
      };
    }),

  /**
   * Text-to-Speech: synthesize AI response text into audio.
   * Returns base64-encoded MP3 audio for the frontend to play.
   */
  speak: protectedProcedure
    .use(rateLimited("voice.speak", VOICE_LIMIT))
    .input(
      z.object({
        text: z.string().min(1).max(4000),
        voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).default("nova"),
        speed: z.number().min(0.25).max(4.0).default(1.0),
      })
    )
    .mutation(async ({ input }) => {
      const { synthesizeSpeech } = await import("../_core/voiceTts");
      const result = await synthesizeSpeech({
        text: input.text,
        voice: input.voice,
        speed: input.speed,
      });
      if ("error" in result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error,
        });
      }
      return {
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
      };
    }),
});
