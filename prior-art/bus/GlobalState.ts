import { z } from "zod";
import { messageEnvelope } from "./Messages.js";

/** Immer Patch shape: { op, path, value? } */
const patchSchema = z.object({
  op: z.enum(["replace", "remove", "add"]),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});

export const stateUpdateMessage = z.object({
  patches: z.array(patchSchema),
  reversePatches: z.array(patchSchema),
});

export const stateUpdateMessageEnv = messageEnvelope(stateUpdateMessage);

export type StateUpdateMessageEnv = z.infer<typeof stateUpdateMessageEnv>;

/**
 * A content item on the stack. JSON-LD-style description of a subject,
 * including the pre-parsed hast tree for rendering.
 */
export const contentItemSchema = z.object({
  /** Subject IRI. */
  "@id": z.string(),
  /** rdf:type IRIs. */
  "@type": z.array(z.string()).default([]),
  /** rdfs:label */
  label: z.string().default(""),
  /** Parsed hast tree (Root node), or null if unavailable. */
  hastContent: z.unknown().nullable().default(null),
});

export type ContentItem = z.infer<typeof contentItemSchema>;

export const avatarPositionSchema = z.enum([
  "hidden",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
]);

export type AvatarPosition = z.infer<typeof avatarPositionSchema>;

/** A chat message displayed in the speech bubble. */
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  suggestions: z.array(z.string()).optional(),
  allowFreeResponse: z.boolean().optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A pending client tool call from the agent. */
export const pendingToolCallSchema = z.object({
  name: z.string(),
  arguments: z.unknown(),
});

export type PendingToolCall = z.infer<typeof pendingToolCallSchema>;

/**
 * Application state schema.
 */
export const stateSchema = z.object({
  /** Stack of visible content items, most recent last. */
  contentStack: z.array(contentItemSchema).default([]),
  /** Avatar screen position. */
  avatarPosition: avatarPositionSchema.default("hidden"),
  /** Whether the speech bubble is open. */
  bubbleOpen: z.boolean().default(true),
  /** Currently playing animation name, or null. */
  currentAnimation: z.string().nullable().default(null),
  /** Chat message history for the speech bubble. */
  chatMessages: z.array(chatMessageSchema).default([]),
  /** Whether the agent is currently processing. */
  agentBusy: z.boolean().default(false),
  /** Pending client tool calls to be processed by the UI. */
  pendingToolCalls: z.array(pendingToolCallSchema).default([]),
});

export type State = z.infer<typeof stateSchema>;
