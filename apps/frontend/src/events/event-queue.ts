/**
 * The event queue and per-event probabilistic flush policy, as defined by
 * [Event system](../../specs/event-system.spec.md).
 *
 * @see specs/event-system.spec.md#event-queue
 * @see specs/event-system.spec.md#flush-policy
 */

import type { UIEvent, EventType } from './event-types.js';

/** A per-event-type trigger probability. */
export type TriggerProbabilities = Partial<Record<EventType, number>>;

/** The default trigger probabilities per event type. */
export const DEFAULT_TRIGGER_PROBABILITIES: TriggerProbabilities = {
  document_opened: 0.5,
  document_closed: 0.0,
  attention_drawn: 0.2,
  relationship_traversed: 0.5,
  direct_address: 1.0,
  scroll: 0.05,
  avatar_repositioned: 0.0,
};

/** A randomness source for the flush roll. */
export interface RandomSource {
  next(): number;
}

/** The default Math.random-based randomness source. */
export const defaultRandom: RandomSource = {
  next: () => Math.random(),
};

/**
 * The event queue: accumulates events and flushes them per the per-event
 * probabilistic flush policy, as defined by [Event system](../../specs/event-system.spec.md).
 *
 * When a flush occurs, the `onFlush` callback is called with the flushed
 * events. Events that are sent to the model are consumed (removed from the
 * queue); events produced during an in-progress interaction are retained and
 * rolled for after the interaction completes.
 */
export class EventQueue {
  private readonly queue: UIEvent[] = [];
  private readonly probabilities: TriggerProbabilities;
  private readonly random: RandomSource;
  private readonly onFlush: (events: UIEvent[]) => void;
  private interactionInProgress = false;

  constructor(options: {
    probabilities?: TriggerProbabilities;
    random?: RandomSource;
    onFlush: (events: UIEvent[]) => void;
  }) {
    this.probabilities = options.probabilities ?? DEFAULT_TRIGGER_PROBABILITIES;
    this.random = options.random ?? defaultRandom;
    this.onFlush = options.onFlush;
  }

  /** Add an event to the queue and roll for flush. */
  add(event: UIEvent): void {
    this.queue.push(event);
    if (this.interactionInProgress) {
      // Rolls are deferred during an interaction.
      return;
    }
    this.roll(event.type);
  }

  /** Called when an interaction begins; defers flush rolls. */
  beginInteraction(): void {
    this.interactionInProgress = true;
  }

  /** Called when an interaction completes; iterates over queued events rolling for flush. */
  endInteraction(): void {
    this.interactionInProgress = false;
    // Iterate over the queued events in order, rolling for flush on each.
    // The first successful roll flushes the queue and triggers the next
    // interaction; remaining events stay in the queue.
    for (const event of this.queue) {
      if (this.roll(event.type)) {
        return;
      }
    }
  }

  /** Roll for a flush against the event type's trigger probability. Returns true if flushed. */
  private roll(type: EventType): boolean {
    const probability = this.probabilities[type] ?? 0;
    if (this.random.next() < probability) {
      this.flush();
      return true;
    }
    return false;
  }

  /** Flush the queue: send all accumulated events to the model and clear consumed events. */
  private flush(): void {
    if (this.queue.length === 0) return;
    const events = [...this.queue];
    this.queue.length = 0;
    this.interactionInProgress = true;
    this.onFlush(events);
  }

  /** The current queue contents (for testing). */
  get pending(): readonly UIEvent[] {
    return this.queue;
  }
}
