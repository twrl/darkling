/**
 * The retrieval HTTP API: endpoints mirroring the `@darkling/knowledge-base`
 * retrieval operations, plus a ToC endpoint, with `since`/invalidation-list
 * wrapping.
 *
 * @see specs/usage-and-deployment.spec.md#client-side-retrieval-and-caching
 * @see specs/content-first-retrieval.spec.md
 */

import { Hono, type Context } from 'hono';
import {
  RetrievalEngine,
  DEFAULT_RETRIEVAL_POLICY,
  asDocumentId,
  asBlockId,
  asSlug,
  isRelationshipType,
  type DocumentResult,
} from '@darkling/knowledge-base';

import { PersistentStore } from './store.js';

/** Wrap a result with the invalidation list when `since` is present. */
function wrap<T>(result: T, store: PersistentStore, since: number | null): unknown {
  if (since === null) return result;
  return {
    result,
    invalid: store.invalidationsSince(since),
    asOf: store.asOf,
  };
}

/** Parse the `since` query param (epoch ms) or null. */
function parseSince(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Create the retrieval sub-app, backed by the persistent store's engine.
 */
export function createRetrievalApp(store: PersistentStore): Hono {
  const engine = new RetrievalEngine(
    store.engineStores.blockStore,
    store.engineStores.propertyIndex,
    store.engineStores.textIndex,
    store.engineStores.relationshipIndex,
    store.engineStores.containmentIndex,
    DEFAULT_RETRIEVAL_POLICY,
  );

  const app = new Hono();

  // --- Retrieval by ID ---

  app.get('/documents/:id', (c) => {
    const since = parseSince(c.req.query('since'));
    const id = asDocumentId(c.req.param('id'));
    const result = engine.getDocumentsById([id]);
    const doc = result.items[0] ?? null;
    return c.json(wrap(doc, store, since));
  });

  app.get('/documents', (c) => {
    const since = parseSince(c.req.query('since'));
    const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).map(asDocumentId);
    const result = engine.getDocumentsById(ids);
    return c.json(wrap(result, store, since));
  });

  app.get('/blocks/:id', (c) => {
    const since = parseSince(c.req.query('since'));
    const id = asBlockId(c.req.param('id'));
    const result = engine.getBlocksById([id]);
    const block = result.items[0] ?? null;
    return c.json(wrap(block, store, since));
  });

  app.get('/blocks', (c) => {
    const since = parseSince(c.req.query('since'));
    const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).map(asBlockId);
    const result = engine.getBlocksById(ids);
    return c.json(wrap(result, store, since));
  });

  app.get('/by-slug/:slug', (c) => {
    const since = parseSince(c.req.query('since'));
    const slug = asSlug(c.req.param('slug'));
    const result = engine.getDocumentBySlug(slug);
    return c.json(wrap(result, store, since));
  });

  // --- Retrieval by properties ---

  app.get('/query-documents', (c) => {
    const since = parseSince(c.req.query('since'));
    const criteria = parseCriteria(c);
    const page = parsePage(c);
    const result = engine.queryDocuments(criteria, page);
    return c.json(wrap(result, store, since));
  });

  app.get('/query-blocks', (c) => {
    const since = parseSince(c.req.query('since'));
    const criteria = parseCriteria(c);
    const page = parsePage(c);
    const result = engine.queryBlocks(criteria, page);
    return c.json(wrap(result, store, since));
  });

  // --- Text search ---

  app.get('/search-blocks', (c) => {
    const since = parseSince(c.req.query('since'));
    const query = c.req.query('query') ?? '';
    const page = parsePage(c);
    const result = engine.searchBlocks(query, page);
    return c.json(wrap(result, store, since));
  });

  app.get('/search-documents', (c) => {
    const since = parseSince(c.req.query('since'));
    const query = c.req.query('query') ?? '';
    const page = parsePage(c);
    const result = engine.searchDocuments(query, page);
    return c.json(wrap(result, store, since));
  });

  // --- Relationship traversal ---

  app.get('/traverse-outbound/:blockId', (c) => {
    const since = parseSince(c.req.query('since'));
    const blockId = asBlockId(c.req.param('blockId'));
    const typeFilter = parseTypeFilter(c);
    const page = parsePage(c);
    const result = engine.traverseOutbound(blockId, typeFilter, page);
    return c.json(wrap(result, store, since));
  });

  app.get('/traverse-inbound/:blockId', (c) => {
    const since = parseSince(c.req.query('since'));
    const blockId = asBlockId(c.req.param('blockId'));
    const typeFilter = parseTypeFilter(c);
    const page = parsePage(c);
    const result = engine.traverseInbound(blockId, typeFilter, page);
    return c.json(wrap(result, store, since));
  });

  // --- Table of contents ---

  app.get('/toc', (c) => {
    const since = parseSince(c.req.query('since'));
    const docs = engine.queryDocuments([], {});
    const toc = docs.items.map((d: DocumentResult) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
    }));
    return c.json(wrap(toc, store, since));
  });

  return app;
}

function parseCriteria(c: Context): Array<{ property: string; value: string }> {
  // Support a single criterion pair: ?property=slug&value=alpha
  const property = c.req.query('property');
  const value = c.req.query('value');
  if (property && value) return [{ property, value }];
  return [];
}

function parsePage(c: Context): { limit?: number; cursor?: string } {
  const limit = c.req.query('limit');
  const cursor = c.req.query('cursor');
  const page: { limit?: number; cursor?: string } = {};
  if (limit) page.limit = Number(limit);
  if (cursor) page.cursor = cursor;
  return page;
}

function parseTypeFilter(c: Context) {
  const tf = c.req.query('typeFilter');
  return tf && isRelationshipType(tf) ? tf : undefined;
}
