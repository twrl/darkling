/**
 * Errors raised by the state manager authority on rejection of a proposed
 * update, and surfaced through the service bus as `ServiceBusError`
 * subclasses.
 *
 * @see specs/state-manager.spec.md#rejection
 */

import { ServiceBusError } from '@darkling/service-bus';

/**
 * The proposal's `basisSeq` does not match the slice's current authoritative
 * sequence number. The proposal was generated against a snapshot the
 * authority has since superseded; the proposer should refresh its local copy
 * and recompute its patch before re-proposing.
 *
 * @see specs/state-manager.spec.md#optimistic-concurrency
 */
export class StaleBasisError extends ServiceBusError {
  constructor(
    message: string,
    public readonly slice: string,
    public readonly currentSeq: number,
    public readonly basisSeq: number,
  ) {
    super(message, 'STALE_BASIS');
  }
}

/**
 * The proposed resulting value of the slice does not conform to the slice's
 * Zod schema.
 *
 * @see specs/state-manager.spec.md#schema-validity
 */
export class StateInvariantError extends ServiceBusError {
  constructor(
    message: string,
    public readonly slice: string,
    public readonly reason: string,
  ) {
    super(message, 'STATE_INVARIANT');
  }
}

/**
 * The proposed patch could not be applied to the authoritative slice value.
 * This indicates the patch was generated against an incompatible shape, or
 * the patch is malformed.
 *
 * @see specs/state-manager.spec.md#immer-patches
 */
export class PatchNotApplicableError extends ServiceBusError {
  constructor(
    message: string,
    public readonly slice: string,
  ) {
    super(message, 'PATCH_NOT_APPLICABLE');
  }
}
