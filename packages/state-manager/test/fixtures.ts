/**
 * Test helpers and fixtures for the state-manager tests.
 */

import { z } from 'zod';

import type { BroadcastChannelLike, PatchMessage } from '../src/broadcast.js';

/**
 * An in-memory `BroadcastChannel` substitute for tests. Maintains a registry
 * of channels by name so that `createInMemoryChannel(name)` returns the same
 * shared instance for a given name, mimicking the global `BroadcastChannel`
 * behaviour across "threads" within a single process.
 */
export class InMemoryBroadcastChannel implements BroadcastChannelLike {
  private static readonly registry = new Map<string, InMemoryBroadcastChannel>();
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  readonly name: string;
  private closed = false;

  private constructor(name: string) {
    this.name = name;
  }

  static create(name: string): InMemoryBroadcastChannel {
    let channel = InMemoryBroadcastChannel.registry.get(name);
    if (!channel) {
      channel = new InMemoryBroadcastChannel(name);
      InMemoryBroadcastChannel.registry.set(name, channel);
    }
    return channel;
  }

  static reset(): void {
    InMemoryBroadcastChannel.registry.clear();
  }

  postMessage(message: unknown): void {
    if (this.closed) return;
    for (const listener of this.listeners) {
      listener({ data: structuredClone(message) } as MessageEvent);
    }
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    if (type !== 'message') return;
    this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    if (type !== 'message') return;
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    InMemoryBroadcastChannel.registry.delete(this.name);
  }
}

/** Factory for use as `createChannel` in tests. */
export function inMemoryChannelFactory(name: string): BroadcastChannelLike {
  return InMemoryBroadcastChannel.create(name);
}

/** Collect all patch messages posted to a channel, for assertions. */
export function collectPatches(channel: InMemoryBroadcastChannel): PatchMessage[] {
  const received: PatchMessage[] = [];
  channel.addEventListener('message', (event) => {
    received.push(event.data as PatchMessage);
  });
  return received;
}

/** A trivial slice with a `z.unknown()` schema, for tests. */
export function unknownSlice(id: string) {
  return {
    id,
    schema: z.unknown(),
  };
}
