import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const delivered = await notifyOwner({
        userId: input.userId ?? ctx.user.id,
        title: input.title,
        content: input.content,
      });
      return {
        success: delivered,
      } as const;
    }),
});
