/**
 * Retrieval engine — composes the block store and the four indexes, and
 * implements the four retrieval modes defined by Content-first retrieval.
 *
 * @see specs/content-first-retrieval.spec.md#retrieval-modes
 */

import type {
  BlockId,
  ContentBlock,
  Document,
  DocumentId,
  RelationshipType,
  Slug,
} from './model.js';
import { asBlockId, asDocumentId, asSlug } from './model.js';
import type { BlockStore } from './store.js';
import type { PropertyIndex } from './property-index.js';
import type { TextIndex } from './text-index.js';
import type { RelationshipIndex } from './relationship-index.js';
import type { ContainmentIndex } from './containment-index.js';
import { NonFilterablePropertyError } from './property-index.js';
import type {
  BlockResult,
  ByIdResult,
  Cursor,
  DocumentResult,
  PageRequest,
  PageResult,
  PropertyCriterion,
  RetrievalPolicy,
  TraversalResult,
} from './retrieval-types.js';
import { DEFAULT_RETRIEVAL_POLICY } from './retrieval-types.js';

/**
 * The retrieval engine. Composes the five provider abstractions and
 * implements retrieval by ID, by slug, by properties, by textual content, and
 * relationship traversal (outbound and inbound).
 */
export class RetrievalEngine {
  constructor(
    private readonly store: BlockStore,
    private readonly propertyIndex: PropertyIndex,
    private readonly textIndex: TextIndex,
    private readonly relationshipIndex: RelationshipIndex,
    private readonly containmentIndex: ContainmentIndex,
    private readonly policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY,
  ) {}

  // --- Retrieval by ID ---

  getDocumentsById(ids: DocumentId[]): ByIdResult<DocumentResult> {
    const items: DocumentResult[] = [];
    const notFound: string[] = [];
    for (const id of ids) {
      const doc = this.store.getDocumentById(id);
      if (doc) items.push(this.toDocumentResult(doc));
      else notFound.push(id);
    }
    return { items, notFound };
  }

  getBlocksById(ids: BlockId[]): ByIdResult<BlockResult> {
    const items: BlockResult[] = [];
    const notFound: string[] = [];
    for (const id of ids) {
      const block = this.store.getBlockById(id);
      if (block) items.push(this.toBlockResult(block));
      else notFound.push(id);
    }
    return { items, notFound };
  }

  getDocumentBySlug(slug: Slug): DocumentResult | null {
    const doc = this.store.getDocumentBySlug(slug);
    return doc ? this.toDocumentResult(doc) : null;
  }

  // --- Retrieval by properties ---

  queryDocuments(
    criteria: PropertyCriterion[],
    page: PageRequest = {},
  ): PageResult<DocumentResult> {
    const titles = this.documentTitles();
    const docs = this.propertyIndex.queryDocuments(
      criteria.map((c) => ({ property: c.property, value: c.value })),
      titles,
    );
    docs.sort((a, b) => a.id.localeCompare(b.id));
    const results = docs.map((d) => this.toDocumentResult(d));
    return this.paginate(results, page);
  }

  queryBlocks(criteria: PropertyCriterion[], page: PageRequest = {}): PageResult<BlockResult> {
    const blocks = this.propertyIndex.queryBlocks(
      criteria.map((c) => ({ property: c.property, value: c.value })),
    );
    blocks.sort((a, b) => a.document.localeCompare(b.document) || a.id.localeCompare(b.id));
    const results = blocks.map((b) => this.toBlockResult(b));
    return this.paginate(results, page);
  }

  // --- Retrieval by textual content ---

  searchBlocks(query: string, page: PageRequest = {}): PageResult<BlockResult> {
    const hits = this.textIndex.search(query);
    const results = hits
      .map((h) => this.store.getBlockById(h.blockId))
      .filter((b): b is ContentBlock => b !== null)
      .map((b) => this.toBlockResult(b));
    return this.paginate(results, page);
  }

  searchDocuments(query: string, page: PageRequest = {}): PageResult<DocumentResult> {
    const hits = this.textIndex.search(query);
    const seenDocs = new Map<DocumentId, number>();
    for (const h of hits) {
      const block = this.store.getBlockById(h.blockId);
      if (block) {
        seenDocs.set(block.document, Math.max(seenDocs.get(block.document) ?? 0, h.score));
      }
    }
    const docs = [...seenDocs.entries()]
      .map(([id, score]) => ({ doc: this.store.getDocumentById(id), score }))
      .filter((d): d is { doc: Document; score: number } => d.doc !== null)
      .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
      .map((d) => this.toDocumentResult(d.doc));
    return this.paginate(docs, page);
  }

  // --- Relationship traversal ---

  traverseOutbound(
    blockId: BlockId,
    typeFilter?: RelationshipType,
    page: PageRequest = {},
  ): PageResult<TraversalResult> {
    const rels = this.relationshipIndex.traverseOutbound(blockId, typeFilter);
    const results: TraversalResult[] = [];
    for (const r of rels) {
      const block = this.store.getBlockById(r.blockId);
      if (block) {
        results.push({ type: r.type, blockId: r.blockId, block: this.toBlockResult(block) });
      }
    }
    return this.paginate(results, page);
  }

  traverseInbound(
    blockId: BlockId,
    typeFilter?: RelationshipType,
    page: PageRequest = {},
  ): PageResult<TraversalResult> {
    const rels = this.relationshipIndex.traverseInbound(blockId, typeFilter);
    const results: TraversalResult[] = [];
    for (const r of rels) {
      const block = this.store.getBlockById(r.blockId);
      if (block) {
        results.push({ type: r.type, blockId: r.blockId, block: this.toBlockResult(block) });
      }
    }
    return this.paginate(results, page);
  }

  // --- Helpers ---

  private toBlockResult(block: ContentBlock): BlockResult {
    return {
      id: block.id,
      title: block.title,
      document: block.document,
      parent: block.parent,
      content: block.content,
      children: [...block.children],
      relationships: block.relationships.map((r) => ({ type: r.type, target: r.target })),
    };
  }

  private toDocumentResult(doc: Document): DocumentResult {
    const root = this.store.getBlockById(doc.rootBlock);
    return {
      id: doc.id,
      slug: doc.slug,
      title: root?.title ?? '',
      rootBlock: doc.rootBlock,
      annotations: [...doc.annotations],
      metadata: doc.metadata ? { ...doc.metadata } : undefined,
    };
  }

  private documentTitles(): Map<DocumentId, string> {
    const titles = new Map<DocumentId, string>();
    for (const doc of this.store.allDocuments()) {
      const root = this.store.getBlockById(doc.rootBlock);
      if (root) titles.set(doc.id, root.title);
    }
    return titles;
  }

  private paginate<T>(items: T[], page: PageRequest): PageResult<T> {
    const limit = page.limit ?? this.policy.defaultResultLimit;
    const offset = page.cursor ? this.decodeCursor(page.cursor) : 0;
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < items.length;
    return {
      items: slice,
      nextCursor: hasMore ? this.encodeCursor(nextOffset) : null,
      hasMore,
    };
  }

  private encodeCursor(offset: number): Cursor {
    return encodeBase64(JSON.stringify({ offset }));
  }

  private decodeCursor(cursor: Cursor): number {
    try {
      const parsed = JSON.parse(decodeBase64(cursor)) as { offset?: number };
      return typeof parsed.offset === 'number' ? parsed.offset : 0;
    } catch {
      return 0;
    }
  }
}

const encodeBase64 = (value: string): Cursor => {
  // Encode to base64 without Node/DOM APIs. Uses the global `btoa` when
  // available (browsers and Web Workers); otherwise falls back to a
  // prefixed raw encoding that remains opaque to consumers.
  if (typeof btoa === 'function') return btoa(value);
  return `raw:${value}`;
};

const decodeBase64 = (value: string): string => {
  if (value.startsWith('raw:')) return value.slice(4);
  if (typeof atob === 'function') return atob(value);
  return value;
};

// Re-export for consumers.
export { asBlockId, asDocumentId, asSlug, NonFilterablePropertyError };
