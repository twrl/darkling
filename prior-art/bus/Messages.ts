import { z } from "zod";

export function messageEnvelope<Z extends z.core.$ZodType>(body: Z) {
  return z.object({
    head: z.object({
      src: z.string(),
      dst: z.string(),
      msg: z.string(),
      mid: z.string().default(""),
      xfr: z.array(z.unknown()).optional(), // Transferable objects — no narrower Zod type available
    }),
    body,
  });
}

export const anyMessage = messageEnvelope(z.unknown());

export type AnyMessageEnvelope = z.infer<typeof anyMessage>;
