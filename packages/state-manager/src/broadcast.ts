/**
 * The broadcast protocol: Immer patches carried over a named
 * `BroadcastChannel` with monotonic per-slice sequence numbers.
 *
 * @see specs/state-manager.spec.md#broadcast-protocol
 */

import type { Patch } from './model.js';

/**
 * A patch message broadcast by the authority and received by local copies.
 *
 * @see specs/state-manager.spec.md#patch-message
 */
export interface PatchMessage {
  /** The slice identifier. */
  slice: string;
  /** The Immer patch. */
  patch: Patch[];
  /** The sequence number assigned to this update. */
  seq: number;
}

/**
 * Options for {@link createPatchChannel}.
 *
 * @see specs/state-manager.spec.md#channel
 */
export interface PatchChannelOptions {
  /** The name of the `BroadcastChannel` used by the authority and local copies. */
  channelName: string;
  /**
   * An optional factory for the `BroadcastChannel`. Defaults to the global
   * `BroadcastChannel` constructor. Provided so tests can substitute an
   * in-memory implementation.
   */
  createChannel?: (name: string) => BroadcastChannelLike;
}

/**
 * The subset of the `BroadcastChannel` interface used by the state manager.
 */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

/**
 * A typed channel over which the authority posts patch messages and local
 * copies receive them. Wraps a `BroadcastChannel`, isolating the state
 * manager from the raw DOM API and giving it a typed surface.
 *
 * The authority is the sole poster; local copies are receivers. The channel
 * carries only state-manager patch messages; it must not carry service bus
 * command envelopes.
 *
 * @see specs/state-manager.spec.md#channel
 */
export interface PatchChannel {
  /** Post a patch message. Used by the authority only. */
  post(message: PatchMessage): void;
  /** Subscribe to patch messages. Used by local copies only. Returns an unsubscribe function. */
  onMessage(handler: (message: PatchMessage) => void): () => void;
  /** Close the underlying channel. */
  close(): void;
}

/**
 * Create a {@link PatchChannel} over a `BroadcastChannel` with the given
 * name.
 *
 * @see specs/state-manager.spec.md#channel
 */
export function createPatchChannel(options: PatchChannelOptions): PatchChannel {
  const factory = options.createChannel ?? defaultCreateChannel;
  const channel = factory(options.channelName);
  return {
    post(message) {
      channel.postMessage(message);
    },
    onMessage(handler) {
      const listener = (event: MessageEvent) => {
        handler(event.data as PatchMessage);
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close() {
      channel.close();
    },
  };
}

function defaultCreateChannel(name: string): BroadcastChannelLike {
  return new BroadcastChannel(name);
}
