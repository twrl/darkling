/**
 * The local copy: a per-thread immutable snapshot of all slices, updated only
 * by applying broadcast patches, exposed for reactivity through TC39 signals.
 *
 * @see specs/state-manager.spec.md#local-copies
 * @see specs/state-manager.spec.md#reactivity
 */

import { applyPatches, enablePatches } from 'immer';
import { Signal } from 'signal-polyfill';

import type { PatchChannel, PatchMessage } from './broadcast.js';

// Enable Immer's patches API once on module load.
enablePatches();

/**
 * The fetch interface used by a {@link LocalCopy} to obtain authoritative
 * snapshots from the authority. Typically backed by a service-bus proxy to
 * the authority service's `getSnapshot` function.
 *
 * @see specs/state-manager.spec.md#initialisation
 */
export interface SnapshotFetcher {
  /** Fetch the current authoritative value and sequence number of a slice. */
  getSnapshot(slice: string): Promise<{ value: unknown; seq: number }>;
}

/**
 * Options for {@link createLocalCopy}.
 *
 * @see specs/state-manager.spec.md#local-copies
 */
export interface LocalCopyOptions {
  /** The slices this local copy consumes, by identifier. */
  slices: ReadonlyArray<string>;
  /** The patch channel to receive broadcast patches from. */
  channel: PatchChannel;
  /** The fetcher used to obtain authoritative snapshots on boot and gap recovery. */
  fetcher: SnapshotFetcher;
}

/** Per-slice runtime state held by a local copy. */
interface SliceLocalState {
  id: string;
  // The current immutable snapshot value. Replaced (not mutated) on each patch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  // The last-known sequence number for the slice.
  seq: number;
  // Whether the initial snapshot has resolved.
  initialised: boolean;
  // Patches received while a re-fetch is in flight, awaiting application.
  pending: PatchMessage[];
  // Whether a re-fetch is in flight.
  refetching: boolean;
  // The TC39 signal wrapping reads of this slice's value.
  signal: Signal.State<unknown>;
}

/**
 * A per-thread, immutable snapshot of all slices, exposed through TC39
 * signals. Local copies are read-only with respect to mutation: they change
 * only by applying patches received over the {@link PatchChannel}, and by the
 * initial snapshot fetch.
 *
 * @see specs/state-manager.spec.md#local-copies
 * @see specs/state-manager.spec.md#reactivity
 */
export interface LocalCopy {
  /**
   * Read the current immutable value of a slice. Reads are tracked by the
   * slice's TC39 signal, so `Signal.Computed`/`effect` consumers re-evaluate
   * when the slice changes.
   */
  get(slice: string): unknown;
  /** The TC39 signal backing a slice's reads. */
  signal(slice: string): Signal.State<unknown>;
  /** Begin initialisation: fetch snapshots for all slices. */
  init(): Promise<void>;
  /** Tear down the local copy, unsubscribing from the patch channel. */
  dispose(): void;
}

/**
 * Create a {@link LocalCopy} that consumes the given slices.
 *
 * @see specs/state-manager.spec.md#local-copies
 */
export function createLocalCopy(options: LocalCopyOptions): LocalCopy {
  const states = new Map<string, SliceLocalState>();
  for (const id of options.slices) {
    states.set(id, {
      id,
      value: undefined,
      seq: 0,
      initialised: false,
      pending: [],
      refetching: false,
      signal: new Signal.State<unknown>(undefined),
    });
  }

  const unsubscribe = options.channel.onMessage((message) => {
    const state = states.get(message.slice);
    if (!state) return; // not a slice this copy consumes
    applyPatchMessage(state, message, options.fetcher).catch(() => {
      // A re-fetch failure is left to retry by the next gap; the snapshot
      // remains at its last-known sequence. Implementation-defined backoff.
    });
  });

  function get(slice: string): unknown {
    const state = states.get(slice);
    if (!state) throw new Error(`Unknown slice: ${slice}`);
    return state.signal.get();
  }

  function signal(slice: string): Signal.State<unknown> {
    const state = states.get(slice);
    if (!state) throw new Error(`Unknown slice: ${slice}`);
    return state.signal;
  }

  async function init(): Promise<void> {
    await Promise.all(
      Array.from(states.values()).map(async (state) => {
        const { value, seq } = await options.fetcher.getSnapshot(state.id);
        applySnapshot(state, value, seq);
        // Apply any patches buffered during the fetch.
        const pending = state.pending;
        state.pending = [];
        for (const message of pending) {
          applyPatchMessage(state, message, options.fetcher).catch(() => {
            /* see above */
          });
        }
      }),
    );
  }

  function dispose(): void {
    unsubscribe();
  }

  return { get, signal, init, dispose };
}

/**
 * Apply a patch message to a slice's local state, handling sequence
 * ordering, gaps, and re-fetching.
 *
 * @see specs/state-manager.spec.md#ordering-and-delivery
 * @see specs/state-manager.spec.md#gap-recovery
 */
async function applyPatchMessage(
  state: SliceLocalState,
  message: PatchMessage,
  fetcher: SnapshotFetcher,
): Promise<void> {
  // Ignore duplicates and stale deliveries.
  if (message.seq <= state.seq) return;

  if (!state.initialised) {
    // Buffer until the initial snapshot resolves.
    state.pending.push(message);
    return;
  }

  // If a re-fetch is in flight, buffer until it completes.
  if (state.refetching) {
    state.pending.push(message);
    return;
  }

  // Gap: seq > last-known + 1.
  if (message.seq > state.seq + 1) {
    state.refetching = true;
    state.pending.push(message);
    try {
      const { value, seq } = await fetcher.getSnapshot(state.id);
      applySnapshot(state, value, seq);
    } finally {
      state.refetching = false;
    }
    // Apply buffered messages in sequence order, discarding stale ones.
    const pending = state.pending;
    state.pending = [];
    for (const buffered of pending) {
      await applyPatchMessage(state, buffered, fetcher);
    }
    return;
  }

  // In-order patch: apply it.
  try {
    const next = applyPatches(state.value, message.patch);
    applySnapshot(state, next, message.seq);
  } catch {
    // Patch failed to apply: treat as a gap and re-fetch.
    state.refetching = true;
    try {
      const { value, seq } = await fetcher.getSnapshot(state.id);
      applySnapshot(state, value, seq);
    } finally {
      state.refetching = false;
    }
    const pending = state.pending;
    state.pending = [];
    for (const buffered of pending) {
      await applyPatchMessage(state, buffered, fetcher);
    }
  }
}

function applySnapshot(
  state: SliceLocalState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  seq: number,
): void {
  state.value = value;
  state.seq = seq;
  state.initialised = true;
  state.signal.set(value);
}
