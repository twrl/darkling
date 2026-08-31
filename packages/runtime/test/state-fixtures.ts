import { z } from 'zod';

import type { BroadcastChannelLike, PatchMessage } from '../src/broadcast.js';

/**
 * An in-memory `BroadcastChannel` substitute for tests.
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

export function inMemoryChannelFactory(name: string): BroadcastChannelLike {
  return InMemoryBroadcastChannel.create(name);
}

export function collectPatches(channel: InMemoryBroadcastChannel): PatchMessage[] {
  const received: PatchMessage[] = [];
  channel.addEventListener('message', (event) => {
    received.push(event.data as PatchMessage);
  });
  return received;
}

/**
 * A typed slice with a number counter, for testing.
 */
export function counterSlice(id: string = 'counter') {
  return {
    id,
    schema: z.object({ count: z.number() }),
    mutations: {
      increment: {
        params: z.object({ by: z.number().default(1) }),
        transition: (draft: { count: number }, params: { by: number }) => {
          draft.count += params.by;
        },
      },
      set: {
        params: z.object({ value: z.number() }),
        transition: (draft: { count: number }, params: { value: number }) => {
          draft.count = params.value;
        },
      },
    },
  };
}
