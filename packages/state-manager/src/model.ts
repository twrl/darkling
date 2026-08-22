/**
 * The state model: slices, their schemas, and their invariants.
 *
 * @see specs/state-manager.spec.md#state-model
 */

import type { z } from 'zod';

/**
 * The actor proposing an update. Made available to invariant functions so
 * conflict-resolution invariants can distinguish User-sourced from
 * Guide-sourced updates.
 *
 * @see specs/state-manager.spec.md#update-proposals
 */
export type UpdateSource = 'ui' | 'guide' | 'service';

/**
 * An Immer patch, as produced by Immer's `produceWithPatches`. Re-exported
 * from `immer` so the state manager's `Patch` is structurally identical to
 * Immer's, guaranteeing compatibility with `applyPatches` and
 * `produceWithPatches`.
 *
 * @see specs/state-manager.spec.md#immer-patches
 */
export type { Patch } from 'immer';

/**
 * The verdict returned by an invariant function: either accept, or reject
 * with a reason string.
 *
 * @see specs/state-manager.spec.md#slice-invariants
 */
export type InvariantVerdict = { accepted: true } | { accepted: false; reason: string };

/**
 * Context passed to an invariant function.
 *
 * @see specs/state-manager.spec.md#slice-invariants
 */
export interface InvariantContext {
  /** The actor proposing the update. */
  source: UpdateSource;
  /** The sequence number the proposal was generated against. */
  basisSeq: number;
  /** The sequence number the authority will assign if accepted. */
  nextSeq: number;
}

/**
 * A declaration of a slice of shared state. Each slice is an independently
 * versioned, independently updated unit of state.
 *
 * This is the **erased** form used by the registry and authority, where the
 * invariant functions receive the proposed value as `unknown`. The authority
 * validates the value against the slice's schema before calling invariants,
 * so the value is guaranteed to match the schema at that point.
 *
 * To author a slice with a typed schema and typed invariant functions, use
 * {@link defineSlice} with a {@link SliceDefinition}.
 *
 * @see specs/state-manager.spec.md#slices
 */
export interface SliceDeclaration {
  /** The unique slice identifier. */
  id: string;
  /** The Zod v4 schema describing the slice's value. */
  schema: z.ZodType;
  /** Zero or more invariant functions, as defined in Slice invariants. */
  invariants?: ReadonlyArray<
    (proposedValue: unknown, context: InvariantContext) => InvariantVerdict
  >;
}

/**
 * A typed definition of a slice, used with {@link defineSlice} to author a
 * slice with a typed schema and typed invariant functions. The generic
 * parameter carries the slice's value type through to the invariant
 * functions; {@link defineSlice} erases it to the storage-safe
 * {@link SliceDeclaration} form.
 *
 * @see specs/state-manager.spec.md#slices
 */
export interface SliceDefinition<TValue = unknown> {
  /** The unique slice identifier. */
  id: string;
  /** The Zod v4 schema describing the slice's value. */
  schema: z.ZodType<TValue>;
  /** Zero or more invariant functions, as defined in Slice invariants. */
  invariants?: ReadonlyArray<
    (proposedValue: TValue, context: InvariantContext) => InvariantVerdict
  >;
}

/**
 * Define a slice from a typed {@link SliceDefinition}, erasing the value type
 * to the storage-safe {@link SliceDeclaration} form.
 *
 * The erasure is runtime-safe because the authority validates the proposed
 * value against the slice's schema before calling any invariant function,
 * guaranteeing the value matches `TValue` at call time.
 *
 * @see specs/state-manager.spec.md#slices
 */
export function defineSlice<TValue>(definition: SliceDefinition<TValue>): SliceDeclaration {
  return definition as unknown as SliceDeclaration;
}

/**
 * A registry of slice declarations, keyed by slice identifier. The set of
 * slices is fixed and declared up front; slices must not be registered
 * dynamically at runtime.
 *
 * @see specs/state-manager.spec.md#slices
 */
export interface SliceRegistry {
  readonly slices: ReadonlyMap<string, SliceDeclaration>;
}

/**
 * Build a {@link SliceRegistry} from a fixed, ordered set of slice
 * declarations. Slice identifiers must be unique.
 *
 * @see specs/state-manager.spec.md#slices
 */
export function createSliceRegistry(declarations: ReadonlyArray<SliceDeclaration>): SliceRegistry {
  const slices = new Map<string, SliceDeclaration>();
  for (const decl of declarations) {
    if (slices.has(decl.id)) {
      throw new Error(`Duplicate slice identifier: ${decl.id}`);
    }
    slices.set(decl.id, decl);
  }
  return { slices };
}
