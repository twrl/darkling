import { describe, it, expect } from 'vitest';

import { InMemoryBlockStore } from '../src/store.js';
import { InMemoryPropertyIndex } from '../src/property-index.js';
import { InMemoryTextIndex } from '../src/text-index.js';
import { InMemoryRelationshipIndex } from '../src/relationship-index.js';
import { InMemoryContainmentIndex } from '../src/containment-index.js';
import { asBlockId, asDocumentId, asSlug } from '../src/model.js';
import { sampleModel } from './fixtures.js';

describe('InMemoryBlockStore', () => {
  it('looks up documents by ID and slug in O(1)', () => {
    const store = new InMemoryBlockStore();
    store.bulkLoad(sampleModel);
    expect(store.getDocumentById(asDocumentId('ceph-biology'))?.id).toBe('ceph-biology');
    expect(store.getDocumentBySlug(asSlug('ceph-tech'))?.id).toBe('ceph-tech');
    expect(store.getDocumentById(asDocumentId('nope'))).toBeNull();
  });

  it('looks up blocks by ID', () => {
    const store = new InMemoryBlockStore();
    store.bulkLoad(sampleModel);
    expect(store.getBlockById(asBlockId('ceph-biology:1'))?.title).toBe('Ceph Biology');
    expect(store.getBlockById(asBlockId('nope'))).toBeNull();
  });
});

describe('InMemoryPropertyIndex', () => {
  it('rejects non-filterable properties', () => {
    const index = new InMemoryPropertyIndex();
    index.bulkLoad(sampleModel);
    expect(() => index.queryBlocks([{ property: 'content', value: 'x' }])).toThrow();
  });
});

describe('InMemoryTextIndex', () => {
  it('returns ranked hits', () => {
    const index = new InMemoryTextIndex();
    index.bulkLoad(sampleModel);
    const hits = index.search('cephalopod');
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('InMemoryRelationshipIndex', () => {
  it('traverses outbound and inbound', () => {
    const index = new InMemoryRelationshipIndex();
    index.bulkLoad(sampleModel);
    expect(index.traverseOutbound(asBlockId('ceph-biology:1'))).toHaveLength(1);
    expect(index.traverseInbound(asBlockId('ceph-tech:1'))).toHaveLength(1);
  });
});

describe('InMemoryContainmentIndex', () => {
  it('returns parent and children', () => {
    const index = new InMemoryContainmentIndex();
    index.bulkLoad(sampleModel);
    expect(index.getParent(asBlockId('ceph-biology:1.1'))).toBe('ceph-biology:1');
    expect(index.getChildren(asBlockId('ceph-biology:1'))).toEqual([asBlockId('ceph-biology:1.1')]);
  });

  it('returns a document tree from the root', () => {
    const index = new InMemoryContainmentIndex();
    index.bulkLoad(sampleModel);
    const tree = index.getDocumentTree(asDocumentId('ceph-biology'));
    expect(tree.map((b) => b.id)).toEqual(['ceph-biology:1', 'ceph-biology:1.1']);
  });
});
