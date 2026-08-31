/**
 * The state model: slices, their schemas, and mutations.
 *
 * @see specs/runtime.spec.md#slice-declarations
 */

import type { z } from 'zod';

/**
 * An Immer patch, as produced by Immer's `produceWithPatches`. Re-exported
 * from `immer` so the runtime's `Patch` is structurally identical to
 * Immer's, guaranteeing compatibility with `applyPatches` and
 * `produceWithPatches`.
 *
 * @see specs/runtime.spec.md#state-change-propagation
 */
export type { Patch } from 'immer';

/**
 * A declaration of a named mutation on a slice. A mutation is a semantic
 * state-transition function: an Immer recipe that receives a draft of the
 * slice's current value and the mutation's parameters, and mutates the draft
 * to produce the next state.
 *
 * @see specs/runtime.spec.md#slice-declarations
 */
export interface SliceMutationDeclaration<TValue = unknown, TParams = unknown> {
  /** The Zod v4 schema for the mutation's parameters. */
  params: z.ZodType<TParams>;
  /** An Immer recipe that transitions the slice's value. */
  transition: (draft: TValue, params: TParams) => void;
  /** Human-readable description. */
  description?: string;
}

/**
 * A declaration of a slice of shared state. Each slice is an independently
 * versioned, independently updated unit of state.
 *
 * This is the **erased** form used by the authority, where the value type is
 * `unknown`. The authority validates the value against the slice's schema
 * before calling transitions, so the value is guaranteed to match
 * the schema at that point.
 *
 * To author a slice with a typed schema and typed mutation transitions, use
 * {@link defineSlice} with a {@link SliceDefinition}.
 *
 * The declaration module must follow the `*.slice.ts` naming convention and
 * must export the `SliceDeclaration` as the default export.
 *
 * @see specs/runtime.spec.md#slice-declarations
 */
export interface SliceDeclaration<TValue = unknown> {
  /** The unique slice identifier. */
  id: string;
  /** The Zod v4 schema describing the slice's value. */
  schema: z.ZodType<TValue>;
  /** Named mutation declarations. */
  mutations: Record<string, SliceMutationDeclaration<TValue>>;
}

/**
 * A typed definition of a slice, used with {@link defineSlice} to author a
 * slice with a typed schema and typed mutation transitions. The generic
 * parameter carries the slice's value type through to the mutation
 * transitions; {@link defineSlice} erases it to the storage-safe {@link SliceDeclaration} form.
 *
 * @see specs/runtime.spec.md#slice-declarations
 */
export interface SliceDefinition<TValue = unknown> {
  /** The unique slice identifier. */
  id: string;
  /** The Zod v4 schema describing the slice's value. */
  schema: z.ZodType<TValue>;

  /** Named mutation declarations. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutations: Record<string, SliceMutationDeclaration<TValue, any>>;
}

/**
 * Define a slice from a typed {@link SliceDefinition}, erasing the value type
 * to the storage-safe {@link SliceDeclaration} form.
 *
 * The erasure is runtime-safe because the authority validates the proposed
 * value against the slice's schema before calling any transition function,
 * guaranteeing the value matches `TValue` at call time.
 *
 * @see specs/runtime.spec.md#slice-declarations
 */
export function defineSlice<TValue>(
  definition: SliceDefinition<TValue>,
): SliceDeclaration<unknown> {
  return definition as unknown as SliceDeclaration<unknown>;
}
