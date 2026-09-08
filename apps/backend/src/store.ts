/**
 * The persistent store: provider-interface implementations backing retrieval,
 * populated by compilation. The initial implementation is in-memory, reusing
 * `@darkling/knowledge-base`'s in-memory stores; swappable for Redis/Upstash
 * via the provider-interface abstraction.
 *
 * Also tracks the last-modified timestamp of each document/block to support
 * the `since`/invalidation-list mechanism, as defined by
 * [Content-first retrieval](../../specs/content-first-retrieval.spec.md#client-side-caching).
 *
 * @see specs/content-first-retrieval.spec.md#client-side-caching
 */

import {
  createInMemoryStores,
  type InMemoryStores,
  type CompiledModel,
} from '@darkling/knowledge-base';

/** The invalidation list: IDs of documents/blocks changed since a timestamp. */
export interface InvalidationList {
  documents: string[];
  blocks: string[];
}

/** The persistent store, wrapping the knowledge-base stores with invalidation tracking. */
export class PersistentStore {
  private readonly stores: InMemoryStores;
  /** lastModified per document id (epoch ms). */
  private readonly documentModified = new Map<string, number>();
  /** lastModified per block id (epoch ms). */
  private readonly blockModified = new Map<string, number>();
  /** The last load timestamp (epoch ms), for "since" comparisons. */
  private lastLoadAt = 0;

  constructor() {
    this.stores = createInMemoryStores();
  }

  /** Load a compiled model into the stores, updating modification timestamps. */
  load(model: CompiledModel): void {
    this.stores.load(model);
    const now = Date.now();
    this.lastLoadAt = now;
    this.documentModified.clear();
    this.blockModified.clear();
    for (const doc of model.documents) {
      this.documentModified.set(doc.id, now);
    }
    for (const block of model.blocks) {
      this.blockModified.set(block.id, now);
    }
  }

  /** The underlying knowledge-base stores, for the retrieval engine. */
  get engineStores(): InMemoryStores {
    return this.stores;
  }

  /** Compute the invalidation list: IDs modified since `since`. */
  invalidationsSince(since: number): InvalidationList {
    const documents: string[] = [];
    const blocks: string[] = [];
    for (const [id, ts] of this.documentModified) {
      if (ts > since) documents.push(id);
    }
    for (const [id, ts] of this.blockModified) {
      if (ts > since) blocks.push(id);
    }
    return { documents, blocks };
  }

  /** The timestamp to use as the next `since` (the last load time). */
  get asOf(): number {
    return this.lastLoadAt;
  }

  /** Whether the store has loaded a model. */
  get loaded(): boolean {
    return this.lastLoadAt > 0;
  }
}
