/**
 * Filterable property schema, as defined by
 * [Property schema](../../specs/authoring-tooling.spec.md#property-schema).
 *
 * @see specs/authoring-tooling.spec.md#property-schema
 */

import type { Document, ContentBlock } from './model.js';

/**
 * Match semantics for a filterable property.
 *
 * @see specs/authoring-tooling.spec.md#filterable-properties
 */
export type MatchSemantics = 'exact' | 'substring';

/**
 * The set of filterable document properties, as established by
 * [Authoring tooling](../../specs/authoring-tooling.spec.md#filterable-properties).
 */
export type FilterableDocumentProperty = 'slug' | 'title';

/**
 * The set of filterable content block properties, as established by
 * [Authoring tooling](../../specs/authoring-tooling.spec.md#filterable-properties).
 */
export type FilterableBlockProperty = 'title' | 'document';

/**
 * A property schema entry: the match semantics for one filterable property.
 */
export interface PropertySchemaEntry {
  property: string;
  match: MatchSemantics;
}

/**
 * The default property schema, conforming to the table in
 * [Authoring tooling](../../specs/authoring-tooling.spec.md#filterable-properties).
 *
 * Document `slug` and block `document` use exact matching; document `title`
 * and block `title` use substring matching.
 */
export const DEFAULT_PROPERTY_SCHEMA = {
  document: {
    slug: { match: 'exact' as const },
    title: { match: 'substring' as const },
  },
  block: {
    title: { match: 'substring' as const },
    document: { match: 'exact' as const },
  },
} as const satisfies PropertySchema;

/**
 * The full property schema: filterable properties and match semantics for
 * documents and content blocks.
 */
export interface PropertySchema {
  document: Record<FilterableDocumentProperty, { match: MatchSemantics }>;
  block: Record<FilterableBlockProperty, { match: MatchSemantics }>;
}

export const isFilterableDocumentProperty = (value: string): value is FilterableDocumentProperty =>
  value === 'slug' || value === 'title';

export const isFilterableBlockProperty = (value: string): value is FilterableBlockProperty =>
  value === 'title' || value === 'document';

/**
 * Apply a property criterion to a document, per the schema's match semantics.
 * Returns true if the document matches.
 */
export const documentMatchesCriterion = (
  doc: Document,
  property: FilterableDocumentProperty,
  value: string,
  schema: PropertySchema = DEFAULT_PROPERTY_SCHEMA,
): boolean => {
  const entry = schema.document[property];
  if (!entry) return false;
  // Document title is the title of its root block; the caller must provide it
  // via the document result. For the raw Document, title is not a field, so
  // document title filtering is handled at the retrieval-engine level, which
  // has access to the root block title. This function handles `slug` only.
  if (property === 'slug') {
    return entry.match === 'exact' ? doc.slug === value : doc.slug.includes(value);
  }
  return false; // title handled at engine level
};

/**
 * Apply a property criterion to a content block, per the schema's match semantics.
 */
export const blockMatchesCriterion = (
  block: ContentBlock,
  property: FilterableBlockProperty,
  value: string,
  schema: PropertySchema = DEFAULT_PROPERTY_SCHEMA,
): boolean => {
  const entry = schema.block[property];
  if (!entry) return false;
  const actual = String(block[property]);
  return entry.match === 'exact' ? actual === value : actual.includes(value);
};
