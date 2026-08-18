/**
 * Retrieval request and result types, as defined by
 * [Content-first retrieval](../../specs/content-first-retrieval.spec.md).
 *
 * @see specs/content-first-retrieval.spec.md
 */

import type { BlockId, DocumentId, RelationshipType } from './model.js';
import { DEFAULT_PROPERTY_SCHEMA, type PropertySchema } from './property-schema.js';

/**
 * A property criterion for retrieval by properties.
 *
 * @see specs/content-first-retrieval.spec.md#retrieval-by-properties
 */
export interface PropertyCriterion {
  /** The filterable property name. */
  property: string;
  /** The match value. */
  value: string;
}

/**
 * A pagination cursor — opaque to the consumer. It is returned with a result
 * set and passed back to retrieve the next page. Its structure is an
 * implementation detail of the retrieval engine and its providers.
 *
 * @see specs/content-first-retrieval.spec.md#pagination-and-limits
 */
export type Cursor = string;

/**
 * A pagination request: a limit and an opaque cursor from a previous result.
 */
export interface PageRequest {
  /** Maximum number of results to return. */
  limit?: number;
  /** Cursor returned by a previous result set, to continue pagination. */
  cursor?: Cursor;
}

/**
 * A paginated result set: items, a cursor for the next page, and a has-more flag.
 *
 * @see specs/content-first-retrieval.spec.md#pagination-and-limits
 */
export interface PageResult<T> {
  items: T[];
  /** Cursor to pass back for the next page, or null if no more results. */
  nextCursor: Cursor | null;
  /** Whether more results are available beyond the current page. */
  hasMore: boolean;
}

/**
 * A retrieval-by-ID result: resolved items in requested order, and the IDs
 * that did not resolve.
 *
 * @see specs/content-first-retrieval.spec.md#retrieval-by-id
 */
export interface ByIdResult<T> {
  /** Resolved objects, in the order of the requested IDs. */
  items: T[];
  /** Requested IDs that did not resolve to an object. */
  notFound: string[];
}

/**
 * A document retrieval result, conforming to the
 * [Document result](../../specs/content-first-retrieval.spec.md#result-shapes)
 * shape.
 */
export interface DocumentResult {
  id: DocumentId;
  slug: string;
  /** The document's title — the title of its root content block. */
  title: string;
  /** The ID of the document's root content block. */
  rootBlock: BlockId;
  /** The document's annotations, as opaque metadata. */
  annotations: unknown[];
  /** Additional document metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * A content block retrieval result — the full block, as defined by the
 * [Content model](../../specs/content-model.spec.md) data contract. Retrieval
 * returns complete blocks; there is no partial-field retrieval mode.
 */
export interface BlockResult {
  id: BlockId;
  title: string;
  document: DocumentId;
  parent: BlockId | null;
  content: string;
  children: BlockId[];
  relationships: Array<{ type: RelationshipType; target: BlockId }>;
}

/**
 * A relationship traversal result entry: the relationship type, the related
 * block ID, and the related block's full result.
 *
 * @see specs/content-first-retrieval.spec.md#relationship-traversal
 */
export interface TraversalResult {
  /** The relationship type. */
  type: RelationshipType;
  /**
   * The target (for outbound) or source (for inbound) block ID.
   */
  blockId: BlockId;
  /** The related block's full content block result. */
  block: BlockResult;
}

/**
 * The retrieval policy parameters, as defined by
 * [Policy parameters](../../specs/content-first-retrieval.spec.md#policy-parameters).
 * All parameters must have defined values.
 */
export interface RetrievalPolicy {
  /** The set of filterable properties and their match semantics. */
  propertySchema: PropertySchema;
  /** The mechanism used for retrieval by textual content. */
  textSearchMechanism: 'linear-scan' | 'inverted-index' | 'vector' | 'hybrid';
  /** The default maximum number of results returned when no limit is specified. */
  defaultResultLimit: number;
  /** The default ordering for retrieval by properties results. */
  defaultSortPolicy: 'document-then-block';
}

/**
 * The default retrieval policy. The text search mechanism is `linear-scan`
 * (the in-memory stub); the default limit is 20; the default sort is by
 * document ID then block ID, ensuring deterministic ordering.
 */
export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = {
  propertySchema: DEFAULT_PROPERTY_SCHEMA,
  textSearchMechanism: 'linear-scan',
  defaultResultLimit: 20,
  defaultSortPolicy: 'document-then-block',
};
