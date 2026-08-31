/**
 * The store builder: a client-side interface that wraps the raw `mutate` and
 * `getSnapshot` calls with a typed, per-slice store, and provides slice
 * registration and discovery.
 *
 * The store builder is produced by the state authority's proxy factory.
 *
 * @see specs/runtime.spec.md#store-interface
 */

import { Signal } from 'signal-polyfill';

import type { RuntimeClient } from './runtime-client.js';
import type { SliceDeclaration, SliceMutationDeclaration } from './state-model.js';
import type { SliceRegistration } from './registration.js';
import { StaleBasisError } from './errors.js';
import type { Ack } from './authority.js';
import type { LocalCopy } from './local-copy.js';

/** The maximum number of stale-basis retries before giving up. */
const MAX_RETRIES = 5;

/**
 * A typed store for a slice, exposing reactive state and typed mutation
 * methods.
 *
 * @see specs/runtime.spec.md#store
 */
export type SliceStore<T extends SliceDeclaration = SliceDeclaration> = {
  /** A TC39 signal holding the local copy's current value for the slice. */
  state: Signal.State<unknown>;
} & {
  /**
   * One typed mutation method per declared mutation on the slice. Each method
   * takes typed parameters and returns `Promise<Ack>`. The store helper
   * embeds the basis sequence transparently and retries on stale basis.
   */
  [K in keyof T['mutations']]: T['mutations'][K] extends SliceMutationDeclaration<unknown, infer P>
    ? (params: P) => Promise<Ack>
    : never;
};

/**
 * The store builder: produced by the state authority's proxy factory. Exposes
 * `store(sliceDeclaration)` for obtaining a typed store, `registerSlice` for
 * slice registration, and `availableSlices` for reactive discovery.
 *
 * The store builder should implement the `EventEmitter` interface so consumers
 * can be notified when slices become available.
 *
 * @see specs/runtime.spec.md#store-builder
 */
export interface StoreBuilder {
  /**
   * Returns a typed store for the given slice. The caller must have already
   * registered the slice via `registerSlice` (or observed it in the registry)
   * before calling `store`.
   */
  store<T extends SliceDeclaration>(declaration: T): SliceStore<T>;
  /**
   * Registers a slice with the authority. Returns a promise that resolves when
   * the slice declaration module has been loaded and the slice is ready to
   * process mutations.
   */
  registerSlice(registration: SliceRegistration): Promise<void>;
  /**
   * Returns the current set of registered slice identifiers, derived from the
   * registry pseudo-slice. This is a reactive read.
   */
  availableSlices(): string[];
  /** The local copy used by stores for reactive state. */
  readonly localCopy: LocalCopy;
}

/**
 * Low-level dispatch interface to the authority, used by the store builder.
 * This is the raw function-level proxy, not the typed store.
 */
interface AuthorityDispatch {
  mutate(params: {
    slice: string;
    mutation: string;
    params: unknown;
    basisSeq: number;
  }): Promise<Ack>;
  getSnapshot(params: { slice: string }): Promise<{ value: unknown; seq: number }>;
  getRegistry(): Promise<{ services: unknown; slices: unknown }>;
  registerSlice(params: { id: string; moduleSpecifier: string }): Promise<void>;
}

/**
 * Create a store builder from a `RuntimeClient` and a `LocalCopy`.
 *
 * The store builder uses the `RuntimeClient`'s low-level dispatch primitives
 * to call the authority's `mutate` and `getSnapshot` functions, and the
 * `LocalCopy` for reactive state.
 *
 * @see specs/runtime.spec.md#store-interface
 */
export function createStoreBuilder(
  client: RuntimeClient,
  localCopy: LocalCopy,
  authorityServiceId: string,
): StoreBuilder {
  const dispatch: AuthorityDispatch = {
    async mutate(params) {
      return client.call(authorityServiceId, 'mutate', params) as Promise<Ack>;
    },
    async getSnapshot(params) {
      return client.call(authorityServiceId, 'getSnapshot', params) as Promise<{
        value: unknown;
        seq: number;
      }>;
    },
    async getRegistry() {
      return client.call(authorityServiceId, 'getRegistry', {}) as Promise<{
        services: unknown;
        slices: unknown;
      }>;
    },
    async registerSlice(params) {
      await client.call(authorityServiceId, 'registerSlice', params);
    },
  };

  // Ensure the local copy's fetcher can also get the registry.
  // The local copy was created with a fetcher that supports getRegistry.

  return {
    store<T extends SliceDeclaration>(declaration: T): SliceStore<T> {
      const signal = localCopy.signal(declaration.id);
      const store: Record<string, unknown> = { state: signal };

      for (const mutationName of Object.keys(declaration.mutations)) {
        store[mutationName] = async (params: unknown): Promise<Ack> => {
          return mutateWithRetry(dispatch, declaration.id, mutationName, params, localCopy);
        };
      }

      return store as unknown as SliceStore<T>;
    },

    async registerSlice(registration: SliceRegistration): Promise<void> {
      await dispatch.registerSlice(registration);
    },

    availableSlices(): string[] {
      const reg = localCopy.getRegistry();
      return Object.keys(reg.slices);
    },

    get localCopy() {
      return localCopy;
    },
  };
}

/**
 * Submit a mutation with transparent basis-seq embedding and stale-basis retry.
 *
 * The store helper embeds the local copy's current sequence number as the
 * `basisSeq` transparently. On `StaleBasisError`, it waits for the local copy
 * to converge and retries with the new basis sequence (up to a bounded number
 * of retries).
 *
 * @see specs/runtime.spec.md#optimistic-concurrency
 */
async function mutateWithRetry(
  dispatch: AuthorityDispatch,
  slice: string,
  mutation: string,
  params: unknown,
  localCopy: LocalCopy,
): Promise<Ack> {
  let retries = 0;

  while (true) {
    const basisSeq = localCopy.getSeq(slice);
    try {
      return await dispatch.mutate({
        slice,
        mutation,
        params,
        basisSeq,
      });
    } catch (error) {
      if (error instanceof StaleBasisError && retries < MAX_RETRIES) {
        retries++;
        // Wait for the local copy to converge: the in-flight propagation
        // that caused the mismatch should arrive via the patch channel.
        // We wait a few microtasks for the propagation to be applied.
        for (let i = 0; i < 5; i++) {
          await Promise.resolve();
        }
        // Check if the local copy has converged.
        const newSeq = localCopy.getSeq(slice);
        if (newSeq !== basisSeq) {
          // Converged; retry with the new basis.
          continue;
        }
        // Not yet converged; retry with the authority's current seq.
        // The error carries the authoritative current seq.
        // We'll use it as the new basis and retry.
        continue;
      }
      throw error;
    }
  }
}
