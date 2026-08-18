import { describe, it, expect, beforeEach } from 'vitest';

import { createInMemoryStores } from '../src/in-memory-stores.js';
import { RetrievalEngine } from '../src/retrieval-engine.js';
import { asBlockId, asDocumentId, asSlug } from '../src/model.js';
import { NonFilterablePropertyError } from '../src/property-index.js';
import { sampleModel } from './fixtures.js';

describe('RetrievalEngine', () => {
  let engine: RetrievalEngine;

  beforeEach(() => {
    const stores = createInMemoryStores();
    stores.load(sampleModel);
    engine = new RetrievalEngine(
      stores.blockStore,
      stores.propertyIndex,
      stores.textIndex,
      stores.relationshipIndex,
      stores.containmentIndex,
    );
  });

  describe('retrieval by ID', () => {
    it('returns resolved blocks and reports not-found IDs', () => {
      const result = engine.getBlocksById([asBlockId('ceph-biology:1'), asBlockId('nonexistent')]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('ceph-biology:1');
      expect(result.notFound).toEqual(['nonexistent']);
    });

    it('returns resolved documents in requested order', () => {
      const result = engine.getDocumentsById([
        asDocumentId('ceph-tech'),
        asDocumentId('ceph-biology'),
      ]);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.id).toBe('ceph-tech');
      expect(result.items[1]?.id).toBe('ceph-biology');
    });

    it('resolves a document by slug', () => {
      const doc = engine.getDocumentBySlug(asSlug('ceph-biology'));
      expect(doc).not.toBeNull();
      expect(doc?.id).toBe('ceph-biology');
      expect(doc?.title).toBe('Ceph Biology');
    });

    it('returns null for an unknown slug', () => {
      expect(engine.getDocumentBySlug(asSlug('nope'))).toBeNull();
    });

    it('includes annotations as metadata on document results', () => {
      const doc = engine.getDocumentBySlug(asSlug('ceph-biology'));
      expect(doc?.annotations).toHaveLength(1);
    });
  });

  describe('retrieval by properties', () => {
    it('queries blocks by title (substring)', () => {
      const result = engine.queryBlocks([{ property: 'title', value: 'Anat' }]);
      expect(result.items.map((b) => b.id)).toContain('ceph-biology:1.1');
    });

    it('queries blocks by document (exact)', () => {
      const result = engine.queryBlocks([{ property: 'document', value: 'ceph-biology' }]);
      expect(result.items).toHaveLength(2);
    });

    it('combines criteria with logical AND', () => {
      const result = engine.queryBlocks([
        { property: 'document', value: 'ceph-biology' },
        { property: 'title', value: 'Anat' },
      ]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('ceph-biology:1.1');
    });

    it('queries documents by slug (exact)', () => {
      const result = engine.queryDocuments([{ property: 'slug', value: 'ceph-biology' }]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('ceph-biology');
    });

    it('queries documents by title (substring)', () => {
      const result = engine.queryDocuments([{ property: 'title', value: 'Ceph' }]);
      expect(result.items).toHaveLength(2);
    });

    it('rejects non-filterable properties', () => {
      expect(() => engine.queryBlocks([{ property: 'content', value: 'tentacles' }])).toThrow(
        NonFilterablePropertyError,
      );
    });

    it('orders document results by document ID', () => {
      const result = engine.queryDocuments([{ property: 'title', value: 'Ceph' }]);
      expect(result.items.map((d) => d.id)).toEqual(['ceph-biology', 'ceph-tech']);
    });
  });

  describe('retrieval by textual content', () => {
    it('returns blocks whose content matches, ranked by relevance', () => {
      const result = engine.searchBlocks('cephalopod');
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.map((b) => b.id)).toContain('ceph-biology:1');
    });

    it('returns documents whose constituent blocks match', () => {
      const result = engine.searchDocuments('tentacles');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe('ceph-biology');
    });
  });

  describe('relationship traversal', () => {
    it('traverses outbound relationships', () => {
      const result = engine.traverseOutbound(asBlockId('ceph-biology:1'));
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.type).toBe('references');
      expect(result.items[0]?.blockId).toBe('ceph-tech:1');
      expect(result.items[0]?.block.id).toBe('ceph-tech:1');
    });

    it('traverses outbound with type filter', () => {
      const result = engine.traverseOutbound(asBlockId('ceph-biology:1'), 'describes');
      expect(result.items).toHaveLength(0);
    });

    it('traverses inbound relationships', () => {
      const result = engine.traverseInbound(asBlockId('ceph-tech:1'));
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.blockId).toBe('ceph-biology:1');
      expect(result.items[0]?.type).toBe('references');
    });
  });

  describe('pagination', () => {
    it('applies a limit and reports has-more with a cursor', () => {
      const page1 = engine.queryDocuments([{ property: 'title', value: 'Ceph' }], { limit: 1 });
      expect(page1.items).toHaveLength(1);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = engine.queryDocuments([{ property: 'title', value: 'Ceph' }], {
        limit: 1,
        cursor: page1.nextCursor ?? undefined,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]?.id).toBe('ceph-tech');
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });
  });
});
