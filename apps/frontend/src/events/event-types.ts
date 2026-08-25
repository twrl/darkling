/**
 * The high-level semantic event types and payloads produced by the UI, as
 * defined by [User interface](../../specs/ui.spec.md#events).
 *
 * @see specs/ui.spec.md#events
 * @see specs/event-system.spec.md#event-structure
 */

import { z } from 'zod';

/** A high-level semantic event. */
export interface UIEvent {
  type: EventType;
  timestamp: number;
  payload: EventPayload;
}

/** The controlled vocabulary of event types. */
export type EventType =
  | 'document_opened'
  | 'document_closed'
  | 'attention_drawn'
  | 'relationship_traversed'
  | 'direct_address'
  | 'scroll'
  | 'avatar_repositioned'
  | 'session_start';

/** The payload union, keyed by event type. */
export type EventPayload =
  | { document: string; block?: string }
  | { document: string }
  | { document: string; block: string }
  | { source: string; relationship: string; target: string }
  | { text: string }
  | { document: string; blocks: string[] }
  | { position: string }
  | Record<string, never>; // session_start: empty payload

/** Zod schema for a UI event. */
export const eventSchema = z.object({
  type: z.enum([
    'document_opened',
    'document_closed',
    'attention_drawn',
    'relationship_traversed',
    'direct_address',
    'scroll',
    'avatar_repositioned',
    'session_start',
  ]),
  timestamp: z.number(),
  payload: z.record(z.string(), z.unknown()),
});

// --- Event factory helpers ---

export function documentOpened(document: string, block?: string): UIEvent {
  return { type: 'document_opened', timestamp: Date.now(), payload: { document, block } };
}

export function documentClosed(document: string): UIEvent {
  return { type: 'document_closed', timestamp: Date.now(), payload: { document } };
}

export function attentionDrawn(document: string, block: string): UIEvent {
  return { type: 'attention_drawn', timestamp: Date.now(), payload: { document, block } };
}

export function relationshipTraversed(
  source: string,
  relationship: string,
  target: string,
): UIEvent {
  return {
    type: 'relationship_traversed',
    timestamp: Date.now(),
    payload: { source, relationship, target },
  };
}

export function directAddress(text: string): UIEvent {
  return { type: 'direct_address', timestamp: Date.now(), payload: { text } };
}

export function scrollEvent(document: string, blocks: string[]): UIEvent {
  return { type: 'scroll', timestamp: Date.now(), payload: { document, blocks } };
}

export function avatarRepositioned(position: string): UIEvent {
  return { type: 'avatar_repositioned', timestamp: Date.now(), payload: { position } };
}

/**
 * The `session_start` event: marks the Visitor's arrival at the Archive,
 * emitted once when bootstrap is complete and the frontend is ready, before
 * any Visitor-activity event. Empty payload, as defined by
 * [User interface](../../specs/ui.spec.md#session-start).
 */
export function sessionStart(): UIEvent {
  return { type: 'session_start', timestamp: Date.now(), payload: {} };
}
