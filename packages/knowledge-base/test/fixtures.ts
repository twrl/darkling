import { asBlockId, asDocumentId, asSlug } from '../src/model.js';
import type { CompiledModel } from '../src/model.js';

/**
 * A sample compiled model for retrieval tests.
 *
 * Documents:
 * - "ceph-biology" (slug "ceph-biology") with root block "Ceph Biology"
 *   - block "overview" (content mentions "cephalopod")
 *   - block "anatomy" (content mentions "tentacles")
 * - "ceph-tech" (slug "ceph-tech") with root block "Ceph Technology"
 *   - block "overview" (content mentions "cephalopod")
 *
 * Relationships:
 * - ceph-biology:overview references ceph-tech:overview
 */
export const sampleModel: CompiledModel = {
  documents: [
    {
      id: asDocumentId('ceph-biology'),
      slug: asSlug('ceph-biology'),
      rootBlock: asBlockId('ceph-biology:1'),
      annotations: [{ topic: 'cephalopod-history', content: 'A note.' }],
    },
    {
      id: asDocumentId('ceph-tech'),
      slug: asSlug('ceph-tech'),
      rootBlock: asBlockId('ceph-tech:1'),
      annotations: [],
    },
  ],
  blocks: [
    {
      id: asBlockId('ceph-biology:1'),
      title: 'Ceph Biology',
      document: asDocumentId('ceph-biology'),
      parent: null,
      content: 'The Ceph are a diverse group of cephalopod species.',
      children: [asBlockId('ceph-biology:1.1')],
      relationships: [{ type: 'references', target: asBlockId('ceph-tech:1') }],
    },
    {
      id: asBlockId('ceph-biology:1.1'),
      title: 'Anatomy',
      document: asDocumentId('ceph-biology'),
      parent: asBlockId('ceph-biology:1'),
      content: 'Their anatomy includes tentacles and a mantle.',
      children: [],
      relationships: [],
    },
    {
      id: asBlockId('ceph-tech:1'),
      title: 'Ceph Technology',
      document: asDocumentId('ceph-tech'),
      parent: null,
      content: 'Ceph technology builds on cephalopod biology.',
      children: [],
      relationships: [],
    },
  ],
  report: { rejectedUnknownTypes: [], rejectedUnresolvedTargets: [] },
};
