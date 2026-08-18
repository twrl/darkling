import { describe, it, expect } from 'vitest';

import { compile } from '../src/compiler/compiler.js';
import { StaticContentSource } from '../src/compiler/content-source.js';
import { isRelationshipType } from '../src/model.js';

describe('Compiler', () => {
  it('compiles a simple document with a hierarchy', async () => {
    const source = new StaticContentSource({
      'ceph-biology/overview.md': `# Ceph Biology

The Ceph are a diverse group.

## Anatomy

Their anatomy includes tentacles.
`,
    });
    const model = await compile(source);
    expect(model.documents).toHaveLength(1);
    const doc = model.documents[0]!;
    expect(doc.id).toBe('ceph-biology/overview');
    expect(doc.slug).toBe('ceph-biology');
    expect(doc.rootBlock).toBe('ceph-biology/overview:1');

    expect(model.blocks).toHaveLength(2);
    const root = model.blocks.find((b) => b.id === 'ceph-biology/overview:1');
    expect(root?.title).toBe('Ceph Biology');
    expect(root?.parent).toBeNull();
    expect(root?.children).toEqual(['ceph-biology/overview:1.1']);
    expect(root?.content).toContain('diverse group');

    const anatomy = model.blocks.find((b) => b.id === 'ceph-biology/overview:1.1');
    expect(anatomy?.title).toBe('Anatomy');
    expect(anatomy?.parent).toBe('ceph-biology/overview:1');
    expect(anatomy?.content).toContain('tentacles');
  });

  it('derives IDs independent of heading text', async () => {
    const sourceA = new StaticContentSource({
      'doc.md': `# Original Title\n\nBody.\n`,
    });
    const sourceB = new StaticContentSource({
      'doc.md': `# Changed Title\n\nBody.\n`,
    });
    const [modelA, modelB] = await Promise.all([compile(sourceA), compile(sourceB)]);
    expect(modelA.documents[0]?.id).toBe(modelB.documents[0]?.id);
    expect(modelA.blocks[0]?.id).toBe(modelB.blocks[0]?.id);
    expect(modelA.documents[0]?.slug).toBe('original-title');
    expect(modelB.documents[0]?.slug).toBe('changed-title');
  });

  it('compiles relationships from frontmatter and admits recognised types', async () => {
    const source = new StaticContentSource({
      'a.md': `---
relationships:
  - from: "1"
    type: references
    to: b:1
---

# A

Content.
`,
      'b.md': `# B\n\nContent.\n`,
    });
    const model = await compile(source);
    const a = model.blocks.find((b) => b.id === 'a:1');
    expect(a?.relationships).toEqual([{ type: 'references', target: 'b:1' }]);
  });

  it('rejects unknown relationship types and reports them', async () => {
    const source = new StaticContentSource({
      'a.md': `---
relationships:
  - from: "1"
    type: vaguely-related-to
    to: a:1
---

# A

Content.
`,
    });
    const model = await compile(source);
    expect(model.report.rejectedUnknownTypes).toHaveLength(1);
    expect(model.report.rejectedUnknownTypes[0]?.type).toBe('vaguely-related-to');
  });

  it('rejects unresolved targets and reports them', async () => {
    const source = new StaticContentSource({
      'a.md': `---
relationships:
  - from: "1"
    type: references
    to: nonexistent
---

# A

Content.
`,
    });
    const model = await compile(source);
    expect(model.report.rejectedUnresolvedTargets).toHaveLength(1);
    expect(model.report.rejectedUnresolvedTargets[0]?.target).toBe('nonexistent');
  });

  it('preserves directionality (no inferred reverse)', async () => {
    const source = new StaticContentSource({
      'a.md': `---
relationships:
  - from: "1"
    type: references
    to: b:1
---

# A

Content.
`,
      'b.md': `# B\n\nContent.\n`,
    });
    const model = await compile(source);
    const b = model.blocks.find((b) => b.id === 'b:1');
    expect(b?.relationships).toEqual([]);
  });

  it('compiles annotations as opaque document metadata', async () => {
    const source = new StaticContentSource({
      'doc.md': `---
annotations:
  - topic: cephalopod-history
    content: A note.
---

# Doc

Content.
`,
    });
    const model = await compile(source);
    expect(model.documents[0]?.annotations).toEqual([
      { topic: 'cephalopod-history', content: 'A note.' },
    ]);
  });

  it('is deterministic across recompilations', async () => {
    const files = {
      'a.md': `# A\n\nContent.\n`,
      'b.md': `# B\n\nMore.\n`,
    };
    const [m1, m2] = await Promise.all([
      compile(new StaticContentSource(files)),
      compile(new StaticContentSource(files)),
    ]);
    expect(m1.documents.map((d) => d.id)).toEqual(m2.documents.map((d) => d.id));
    expect(m1.blocks.map((b) => b.id)).toEqual(m2.blocks.map((b) => b.id));
  });

  it('resolves slug collisions deterministically', async () => {
    const source = new StaticContentSource({
      'a.md': `# Same Title\n\nBody.\n`,
      'b.md': `# Same Title\n\nBody.\n`,
    });
    const model = await compile(source);
    const slugs = model.documents.map((d) => d.slug).sort();
    expect(slugs).toEqual(['same-title', 'same-title-2']);
  });

  it('exposes the controlled vocabulary', () => {
    expect(isRelationshipType('references')).toBe(true);
    expect(isRelationshipType('vaguely-related-to')).toBe(false);
  });
});
