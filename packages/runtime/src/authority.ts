/**
 * The state authority: the colocated service on the broker that holds the
 * authoritative copy of every slice, processes mutations, validates the
 * resulting value against the slice's schema, and propagates accepted changes.
 *
 * @see specs/runtime.spec.md#state-authority
 */

import { applyPatches, enablePatches, produceWithPatches } from 'immer';

import {
  PatchNotApplicableError,
  StaleBasisError,
  ValidationError,
  SliceNotRegisteredError,
} from './errors.js';
import type { PatchChannel } from './broadcast.js';
import type { Patch, SliceDeclaration } from './state-model.js';
import type { RegistryValue } from './registration.js';
import { EMPTY_REGISTRY } from './registration.js';

// Enable Immer's patches API once on module load.
enablePatches();

/**
 * Parameters for a mutation submitted to the authority.
 *
 * @see specs/runtime.spec.md#mutation-processing
 */
export interface MutationParams {
  /** The identifier of the slice to mutate. */
  slice: string;
  /** The name of the mutation to apply. */
  mutation: string;
  /** The mutation's parameters, validated against the mutation's parameter schema. */
  params: unknown;
  /** The sequence number of the slice at which the mutation was generated. */
  basisSeq: number;
}

/**
 * An acknowledgement returned by the authority on acceptance of a mutation.
 *
 * @see specs/runtime.spec.md#mutation-processing
 */
export interface Ack {
  /** The sequence number assigned to the accepted update. */
  seq: number;
}

/**
 * A snapshot returned by `getSnapshot`.
 */
export interface Snapshot {
  /** The authoritative value of the slice. */
  value: unknown;
  /** The current sequence number of the slice. */
  seq: number;
}

/**
 * The authoritative state held by the authority for a slice.
 */
interface SliceState {
  declaration: SliceDeclaration;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  seq: number;
}

/**
 * The state authority — the colocated service on the broker that holds the
 * authoritative copy of every slice, processes mutations, validates the
 * resulting value against the slice's schema, and propagates accepted changes.
 *
 * The authority serialises mutations per slice: it processes mutations one at
 * a time in arrival order, completing validation and propagation of one before
 * processing the next.
 *
 * @see specs/runtime.spec.md#state-authority
 */
export class Authority {
  private readonly states = new Map<string, SliceState>();
  private readonly channel: PatchChannel;
  private readonly queues = new Map<string, Array<() => void>>();
  /** The registry pseudo-slice value. */
  private registry: RegistryValue = EMPTY_REGISTRY;
  /** Callback set by the broker to receive registry updates. */
  private registryUpdateCallback:
    ((update: (registry: RegistryValue) => RegistryValue) => void) | null = null;

  constructor(channel: PatchChannel) {
    this.channel = channel;
  }

  /**
   * Set the callback invoked when the registry pseudo-slice should be updated.
   * Called by the broker during initialization.
   */
  setRegistryUpdateCallback(
    callback: (update: (registry: RegistryValue) => RegistryValue) => void,
  ): void {
    this.registryUpdateCallback = callback;
  }

  /**
   * Register a slice declaration. Called when a `SliceRegistration` is
   * received and the declaration module has been loaded.
   */
  registerSlice(declaration: SliceDeclaration): void {
    if (this.states.has(declaration.id)) {
      throw new Error(`Slice already registered: ${declaration.id}`);
    }
    this.states.set(declaration.id, { declaration, value: undefined, seq: 0 });
  }

  /**
   * Check whether a slice is registered (loaded).
   */
  hasSlice(sliceId: string): boolean {
    return this.states.has(sliceId);
  }

  /**
   * Set the initial value of a slice. Must be called before any mutation
   * targets the slice. The initial value must conform to the slice's schema.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(slice: string, value: any): void {
    const state = this.states.get(slice);
    if (!state) throw new SliceNotRegisteredError(slice);
    const parsed = state.declaration.schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Initial value for slice "${slice}" fails schema: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    state.value = parsed.data;
    state.seq = 0;
  }

  /**
   * Return the current authoritative value and sequence number of a slice.
   * Used for initialisation and gap recovery.
   *
   * @see specs/runtime.spec.md#local-copies
   */
  getSnapshot(slice: string): Snapshot {
    const state = this.states.get(slice);
    if (!state) throw new SliceNotRegisteredError(slice);
    return { value: state.value, seq: state.seq };
  }

  /**
   * Get the registry pseudo-slice value.
   */
  getRegistry(): RegistryValue {
    return this.registry;
  }

  /**
   * Update the registry pseudo-slice. Called by the broker when service or
   * slice registrations change. This is a direct update (not through the
   * mutation path), as the registry is a pseudo-slice.
   *
   * @see specs/runtime.spec.md#registry-pseudo-slice
   */
  updateRegistry(update: (registry: RegistryValue) => RegistryValue): void {
    this.registry = update(this.registry);
    // Propagate the registry change as a special patch message with the
    // slice name '__registry'. Local copies treat this as a registry update.
    this.channel.post({
      slice: '__registry',
      patch: [],
      seq: 0,
    });
    // Also notify the broker's callback if set.
    if (this.registryUpdateCallback) {
      this.registryUpdateCallback(update);
    }
  }

  /**
   * Submit a named mutation for a slice. The authority applies the mutation's
   * transition function to the authoritative state, validates the result, and
   * propagates the change. Resolves with an acknowledgement on acceptance,
   * rejects with an error on rejection.
   *
   * The authority serialises mutations per slice: mutations are processed one
   * at a time in arrival order.
   *
   * @see specs/runtime.spec.md#mutation-processing
   */
  async mutate(params: MutationParams): Promise<Ack> {
    const { slice } = params;
    // Serialise per-slice: chain onto the slice's queue.
    await this.enterQueue(slice);
    try {
      return this.process(params);
    } finally {
      this.exitQueue(slice);
    }
  }

  private enterQueue(slice: string): Promise<void> {
    let queue = this.queues.get(slice);
    if (!queue) {
      queue = [];
      this.queues.set(slice, queue);
    }
    if (queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      queue!.push(resolve);
    });
  }

  private exitQueue(slice: string): void {
    const queue = this.queues.get(slice);
    if (!queue) return;
    const next = queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Process a mutation: optimistic concurrency check, apply transition,
   * validate schema, commit, propagate, acknowledge.
   *
   * @see specs/runtime.spec.md#mutation-processing
   */
  private process(params: MutationParams): Ack {
    const state = this.states.get(params.slice);
    if (!state) throw new SliceNotRegisteredError(params.slice);

    const { declaration } = state;

    // Look up the named mutation in the slice declaration.
    const mutationDecl = declaration.mutations?.[params.mutation];
    if (!mutationDecl) {
      throw new ValidationError(
        `Mutation "${params.mutation}" is not declared on slice "${params.slice}"`,
        [],
      );
    }

    // 1. Validate the mutation's parameters against the mutation's parameter schema.
    const paramResult = mutationDecl.params.safeParse(params.params);
    if (!paramResult.success) {
      throw new ValidationError(
        `Parameter validation failed for mutation "${params.mutation}" on slice "${params.slice}"`,
        paramResult.error.issues,
      );
    }

    // 2. Optimistic concurrency: basis must match current seq.
    if (params.basisSeq !== state.seq) {
      throw new StaleBasisError(
        `Stale basis for slice "${params.slice}": proposal basis ${params.basisSeq} != current ${state.seq}`,
        params.slice,
        state.seq,
        params.basisSeq,
      );
    }

    // 3. Apply the mutation's transition function to the authoritative slice
    //    value using Immer's produceWithPatches, producing the proposed
    //    resulting value and the resulting patches.
    let proposedValue: unknown;
    let patches: Patch[];
    try {
      const result = produceWithPatches(state.value, (draft: unknown) => {
        mutationDecl.transition(draft, paramResult.data);
      }) as unknown as [unknown, Patch[], Patch[]];
      proposedValue = result[0];
      patches = result[1];
    } catch (error) {
      throw new PatchNotApplicableError(
        `Transition failed for slice "${params.slice}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        params.slice,
      );
    }

    // 4. Validate the proposed resulting value against the slice's Zod schema.
    //    A mutation whose resulting value does not conform must be rejected.
    const parsed = declaration.schema.safeParse(proposedValue);
    if (!parsed.success) {
      throw new ValidationError(
        `Proposed value for slice "${params.slice}" fails schema validation`,
        parsed.error.issues,
      );
    }
    proposedValue = parsed.data;

    // 5. Commit: assign the next sequence number and update the authoritative value.
    const nextSeq = state.seq + 1;
    state.value = proposedValue;
    state.seq = nextSeq;

    // 6. Propagate the change with the new sequence number.
    this.channel.post({ slice: params.slice, patch: patches, seq: nextSeq });

    // 7. Resolve with an acknowledgement carrying the assigned sequence number.
    return { seq: nextSeq };
  }
}
