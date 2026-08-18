/**
 * Property index — supports retrieval by properties. Indexes all filterable
 * properties and supports conjunctive (logical AND) queries over multiple
 * property criteria.
 *
 * @see specs/content-first-retrieval.spec.md#storage-and-indexing
 */

import type { CompiledModel, ContentBlock, Document, BlockId, DocumentId } from './model.js';
import {
  blockMatchesCriterion,
  documentMatchesCriterion,
  isFilterableBlockProperty,
  isFilterableDocumentProperty,
  DEFAULT_PROPERTY_SCHEMA,
  type FilterableBlockProperty,
  type FilterableDocumentProperty,
  type PropertySchema,
} from './property-schema.js';

/**
 * The property index interface. Platform-neutral; an in-memory reference
 * implementation is provided by `InMemoryPropertyIndex`.
 */
export interface PropertyIndex {
  queryDocuments(
    criteria: Array<{ property: string; value: string }>,
    documentTitles: Map<DocumentId, string>,
  ): Document[];
  queryBlocks(criteria: Array<{ property: string; value: string }>): ContentBlock[];
  bulkLoad(model: CompiledModel): void;
}

/**
 * In-memory property index. Performs a scan with logical AND over criteria.
 * The spec requires the index to support conjunctive queries; the in-memory
 * implementation is a linear scan, which is conformant for the reference
 * implementation. A real index (e.g. Redis sets) would intersect matching sets.
 */
export class InMemoryPropertyIndex implements PropertyIndex {
  private readonly schema: PropertySchema;
  private documents: Document[] = [];
  private blocks: ContentBlock[] = [];

  constructor(schema: PropertySchema = DEFAULT_PROPERTY_SCHEMA) {
    this.schema = schema;
  }

  bulkLoad(model: CompiledModel): void {
    this.documents = [...model.documents];
    this.blocks = [...model.blocks];
  }

  queryDocuments(
    criteria: Array<{ property: string; value: string }>,
    documentTitles: Map<DocumentId, string>,
  ): Document[] {
    // Reject non-filterable properties.
    for (const c of criteria) {
      if (!isFilterableDocumentProperty(c.property)) {
        throw new NonFilterablePropertyError(c.property);
      }
    }
    return this.documents.filter((doc) =>
      criteria.every((c) => {
        if (c.property === 'title') {
          const title = documentTitles.get(doc.id) ?? '';
          const entry = this.schema.document.title;
          return entry.match === 'exact' ? title === c.value : title.includes(c.value);
        }
        return documentMatchesCriterion(
          doc,
          c.property as FilterableDocumentProperty,
          c.value,
          this.schema,
        );
      }),
    );
  }

  queryBlocks(criteria: Array<{ property: string; value: string }>): ContentBlock[] {
    for (const c of criteria) {
      if (!isFilterableBlockProperty(c.property)) {
        throw new NonFilterablePropertyError(c.property);
      }
    }
    return this.blocks.filter((block) =>
      criteria.every((c) =>
        blockMatchesCriterion(block, c.property as FilterableBlockProperty, c.value, this.schema),
      ),
    );
  }
}

/**
 * Error thrown when retrieval by a non-filterable property is attempted.
 *
 * @see specs/content-first-retrieval.spec.md#retrieval-by-properties —
 * "Retrieval by a non-filterable property must be rejected."
 */
export class NonFilterablePropertyError extends Error {
  constructor(public readonly property: string) {
    super(`Property "${property}" is not filterable.`);
    this.name = 'NonFilterablePropertyError';
  }
}

/** Re-exported for the retrieval engine's block-id ordering. */
export type { BlockId };
