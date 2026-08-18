/**
 * Block store — holds all compiled documents and content blocks; the source of
 * truth for content. Supports O(1) lookup by document ID, document slug, and
 * block ID. The store is read-only with respect to the Guide.
 *
 * @see specs/content-first-retrieval.spec.md#block-store
 */

import type { CompiledModel, Document, DocumentId, ContentBlock, BlockId, Slug } from './model.js';

/**
 * The block store interface. Platform-neutral; an in-memory reference
 * implementation is provided by `InMemoryBlockStore`. A Redis/Upstash-backed
 * implementation may be provided separately.
 */
export interface BlockStore {
  getDocumentById(id: DocumentId): Document | null;
  getDocumentBySlug(slug: Slug): Document | null;
  getBlockById(id: BlockId): ContentBlock | null;
  /** Populate the store from a compiled model. */
  bulkLoad(model: CompiledModel): void;
  /** All documents (for retrieval by properties / text search over documents). */
  allDocuments(): Iterable<Document>;
  /** All blocks (for retrieval by properties / text search over blocks). */
  allBlocks(): Iterable<ContentBlock>;
}

/**
 * In-memory block store. Holds documents and blocks in `Map`s for O(1) lookup.
 */
export class InMemoryBlockStore implements BlockStore {
  private readonly documentsById = new Map<DocumentId, Document>();
  private readonly documentsBySlug = new Map<Slug, Document>();
  private readonly blocksById = new Map<BlockId, ContentBlock>();

  getDocumentById(id: DocumentId): Document | null {
    return this.documentsById.get(id) ?? null;
  }

  getDocumentBySlug(slug: Slug): Document | null {
    return this.documentsBySlug.get(slug) ?? null;
  }

  getBlockById(id: BlockId): ContentBlock | null {
    return this.blocksById.get(id) ?? null;
  }

  bulkLoad(model: CompiledModel): void {
    for (const doc of model.documents) {
      this.documentsById.set(doc.id, doc);
      this.documentsBySlug.set(doc.slug, doc);
    }
    for (const block of model.blocks) {
      this.blocksById.set(block.id, block);
    }
  }

  allDocuments(): Iterable<Document> {
    return this.documentsById.values();
  }

  allBlocks(): Iterable<ContentBlock> {
    return this.blocksById.values();
  }
}
