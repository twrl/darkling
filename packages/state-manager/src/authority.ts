/**
 * The authority: the single process that holds the authoritative copy of the
 * shared state, receives proposed updates, enforces invariants, and
 * broadcasts accepted patches.
 *
 * @see specs/state-manager.spec.md#authority
 */

import { applyPatches, enablePatches, produceWithPatches } from 'immer';

import { PatchNotApplicableError, StaleBasisError, StateInvariantError } from './errors.js';
import type { PatchChannel } from './broadcast.js';
import type { InvariantContext, Patch, SliceDeclaration, UpdateSource } from './model.js';

// Enable Immer's patches API once on module load.
enablePatches();

/**
 * A proposed update submitted to the authority.
 *
 * @see specs/state-manager.spec.md#proposal-structure
 */
export interface Proposal {
  /** The identifier of the slice to update. */
  slice: string;
  /** The proposed Immer patch, generated against the proposer's last-known snapshot. */
  patch: Patch[];
  /** The sequence number of the slice at which the proposal's patch was generated. */
  basisSeq: number;
  /** The actor proposing the update. */
  source: UpdateSource;
}

/**
 * An acknowledgement returned by the authority on acceptance of a proposal.
 *
 * @see specs/state-manager.spec.md#acceptance
 */
export interface Ack {
  /** The sequence number assigned to the accepted update. */
  seq: number;
}

/**
 * The authoritative state held by the {@link Authority}.
 */
interface SliceState {
  declaration: SliceDeclaration;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  seq: number;
}

/**
 * The single process that holds the authoritative copy of the shared state.
 * It receives proposed updates, enforces invariants, and broadcasts accepted
 * patches over a {@link PatchChannel}.
 *
 * The authority serialises `proposeUpdate` calls: it processes proposed
 * updates one at a time in arrival order, completing validation and
 * broadcast of one before processing the next.
 *
 * @see specs/state-manager.spec.md#authority
 */
export class Authority {
  private readonly states = new Map<string, SliceState>();
  private readonly channel: PatchChannel;
  // A per-slice queue of pending proposals, ensuring serial processing.
  private readonly queues = new Map<string, Array<() => void>>();
  private readonly slices: ReadonlyMap<string, SliceDeclaration>;

  constructor(slices: ReadonlyMap<string, SliceDeclaration>, channel: PatchChannel) {
    this.slices = slices;
    this.channel = channel;
    for (const [id, declaration] of this.slices) {
      this.states.set(id, { declaration, value: undefined, seq: 0 });
    }
  }

  /**
   * Set the initial value of a slice. Must be called before any proposal
   * targets the slice. The initial value must conform to the slice's schema.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(slice: string, value: any): void {
    const state = this.states.get(slice);
    if (!state) throw new Error(`Unknown slice: ${slice}`);
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
   * @see specs/state-manager.spec.md#initialisation
   */
  getSnapshot(slice: string): { value: unknown; seq: number } {
    const state = this.states.get(slice);
    if (!state) throw new Error(`Unknown slice: ${slice}`);
    return { value: state.value, seq: state.seq };
  }

  /**
   * Submit a proposed update for validation and, if accepted, broadcast.
   *
   * The authority serialises updates per slice: proposals are processed one
   * at a time in arrival order. On acceptance, the authority assigns the
   * next monotonic sequence number, broadcasts the patch, and resolves with
   * an acknowledgement. On rejection, the call rejects with a
   * `ServiceBusError` subclass and no patch is broadcast.
   *
   * @see specs/state-manager.spec.md#update-path
   */
  async proposeUpdate(proposal: Proposal): Promise<Ack> {
    const slice = proposal.slice;
    // Serialise per-slice: chain onto the slice's queue.
    await this.enterQueue(slice);
    try {
      return this.process(proposal);
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
    } else {
      // queue empty; leave it for reuse.
    }
  }

  private process(proposal: Proposal): Ack {
    const state = this.states.get(proposal.slice);
    if (!state) throw new Error(`Unknown slice: ${proposal.slice}`);

    // 1. Optimistic concurrency: basis must match current seq.
    if (proposal.basisSeq !== state.seq) {
      throw new StaleBasisError(
        `Stale basis for slice "${proposal.slice}": proposal basis ${proposal.basisSeq} != current ${state.seq}`,
        proposal.slice,
        state.seq,
        proposal.basisSeq,
      );
    }

    // 2. Apply the proposed patch to the authoritative slice.
    let proposedValue: unknown;
    try {
      proposedValue = applyPatches(state.value, proposal.patch as Patch[]);
    } catch (error) {
      throw new PatchNotApplicableError(
        `Patch not applicable to slice "${proposal.slice}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        proposal.slice,
      );
    }

    // 3. Validate the resulting value against the slice's Zod schema.
    const parsed = state.declaration.schema.safeParse(proposedValue);
    if (!parsed.success) {
      // Use the service bus ValidationError shape so the host serialises it
      // as a VALIDATION_ERROR. We throw the service-bus ValidationError to
      // reuse the bus's validation-error serialisation.
      // Imported lazily to avoid a circular concern; the host already
      // catches ValidationError by name.
      throw validationError(proposal.slice, parsed.error.issues);
    }
    proposedValue = parsed.data;

    // 4. Run every declared invariant function of the slice.
    const nextSeq = state.seq + 1;
    const invContext: InvariantContext = {
      source: proposal.source,
      basisSeq: proposal.basisSeq,
      nextSeq,
    };
    const invariants = state.declaration.invariants ?? [];
    for (const invariant of invariants) {
      const verdict = invariant(proposedValue, invContext);
      if (!verdict.accepted) {
        throw new StateInvariantError(
          `Invariant rejected update to slice "${proposal.slice}": ${verdict.reason}`,
          proposal.slice,
          verdict.reason,
        );
      }
    }

    // 5. Commit: assign the next sequence number and update the authoritative value.
    state.value = proposedValue;
    state.seq = nextSeq;

    // 6. Broadcast the patch with the new sequence number.
    this.channel.post({ slice: proposal.slice, patch: proposal.patch, seq: nextSeq });

    // 7. Resolve with an acknowledgement carrying the assigned sequence number.
    return { seq: nextSeq };
  }
}

// Lazily import the service-bus ValidationError to reuse its serialisation
// shape, while keeping the authority module free of a hard static dependency
// on the errors module at load time. The host catches ValidationError by
// name and serialises it; throwing the canonical type keeps the error code
// consistent.
import { ValidationError } from '@darkling/service-bus';

function validationError(slice: string, issues: unknown[]): ValidationError {
  return new ValidationError(`Proposed value for slice "${slice}" fails schema validation`, issues);
}

// Re-export the produceWithPatches helper for proposers who wish to compute
// patches using Immer's recipe API. (The authority itself only applies
// patches; proposers generate them.)
export { produceWithPatches };
