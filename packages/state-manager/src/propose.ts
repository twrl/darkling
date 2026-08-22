/**
 * A proposer helper for generating Immer patches against a local snapshot.
 * Proposers compute patches using Immer's recipe API and submit them to the
 * authority via a `proposeUpdate` bus call.
 *
 * @see specs/state-manager.spec.md#update-proposals
 */

import { produceWithPatches } from 'immer';

import type { Patch } from './model.js';

/**
 * Compute an Immer patch against `base` using a recipe. Returns the resulting
 * value, the patches, and the inverse patches. The patches are suitable for
 * submission to the authority's `proposeUpdate` function.
 *
 * @see specs/state-manager.spec.md#immer-patches
 */
export function computePatch<T>(
  base: T,
  recipe: (draft: T) => void,
): { value: T; patches: Patch[]; inverse: Patch[] } {
  const [value, patches, inverse] = produceWithPatches(base, recipe);
  return { value, patches: patches as Patch[], inverse: inverse as Patch[] };
}
