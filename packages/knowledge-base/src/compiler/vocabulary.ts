/**
 * The controlled vocabulary of relationship types, as established by
 * [Controlled vocabularies](../../specs/authoring-tooling.spec.md#controlled-vocabularies).
 *
 * @see specs/authoring-tooling.spec.md#controlled-vocabularies
 */

import { RELATIONSHIP_TYPES, type RelationshipType } from '../model.js';

/**
 * The default controlled vocabulary of relationship types. Re-exported from
 * the model so the compiler and consumers share a single source.
 */
export const DEFAULT_RELATIONSHIP_TYPES: readonly RelationshipType[] = RELATIONSHIP_TYPES;
