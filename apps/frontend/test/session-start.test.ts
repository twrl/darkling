/**
 * Tests for the `session_start` event factory and its trigger-probability
 * default, as established by [User interface](../../specs/ui.spec.md#session-start)
 * and [Event system](../../specs/event-system.spec.md#trigger-probability).
 *
 * @see apps/frontend/src/events/event-types.ts
 * @see apps/frontend/src/events/event-queue.ts
 */

import { describe, expect, it } from 'vitest';

import { sessionStart, eventSchema, type UIEvent } from '../src/events/event-types.js';
import { DEFAULT_TRIGGER_PROBABILITIES } from '../src/events/event-queue.js';

describe('sessionStart', () => {
  it('produces a session_start event with an empty payload', () => {
    const event = sessionStart();
    expect(event.type).toBe('session_start');
    expect(event.payload).toEqual({});
    expect(typeof event.timestamp).toBe('number');
  });

  it('is accepted by the event schema', () => {
    const event = sessionStart();
    expect(eventSchema.safeParse(event).success).toBe(true);
  });

  it('has an empty payload object (no keys)', () => {
    const event: UIEvent = sessionStart();
    expect(Object.keys(event.payload)).toHaveLength(0);
  });
});

describe('DEFAULT_TRIGGER_PROBABILITIES', () => {
  it('assigns session_start a trigger probability of 1.0', () => {
    expect(DEFAULT_TRIGGER_PROBABILITIES.session_start).toBe(1.0);
  });

  it('still assigns direct_address a trigger probability of 1.0', () => {
    expect(DEFAULT_TRIGGER_PROBABILITIES.direct_address).toBe(1.0);
  });
});
