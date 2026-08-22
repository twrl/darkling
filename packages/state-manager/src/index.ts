/**
 * @darkling/state-manager — shared live state across all execution threads.
 *
 * The state manager provides a single authority that serialises proposed
 * updates to shared-state slices, enforces invariants, and broadcasts
 * accepted updates as Immer patches over a `BroadcastChannel`. Each thread
 * holds an immutable local copy that changes only by applying those patches,
 * exposed for reactivity through TC39 signals.
 *
 * Proposed updates flow through the service bus as bus calls to the authority
 * service (`proposeUpdate`, `getSnapshot`); accepted patches broadcast over a
 * peer `BroadcastChannel` separate from the bus transport.
 *
 * @see specs/state-manager.spec.md
 */

export type {
  UpdateSource,
  Patch,
  InvariantVerdict,
  InvariantContext,
  SliceDeclaration,
  SliceDefinition,
  SliceRegistry,
} from './model.js';

export { createSliceRegistry, defineSlice } from './model.js';

export type { Proposal, Ack } from './authority.js';
export { Authority } from './authority.js';

export type {
  PatchMessage,
  PatchChannel,
  PatchChannelOptions,
  BroadcastChannelLike,
} from './broadcast.js';
export { createPatchChannel } from './broadcast.js';

export type { SnapshotFetcher, LocalCopyOptions, LocalCopy } from './local-copy.js';
export { createLocalCopy } from './local-copy.js';

export { computePatch } from './propose.js';

export { StaleBasisError, StateInvariantError, PatchNotApplicableError } from './errors.js';
