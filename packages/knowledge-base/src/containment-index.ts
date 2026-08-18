/**
 * Containment index — supports traversal of the containment hierarchy. Indexes
 * parent–child relationships and supports retrieval of a document's full block
 * tree. Containment is structural (not typed), distinct from the relationship
 * index.
 *
 * @see specs/content-first-retrieval.spec.md#storage-and-indexing
 */

import type { CompiledModel, BlockId, DocumentId, ContentBlock } from './model.js';

/**
 * The containment index interface. Platform-neutral; an in-memory reference
 * implementation is provided by `InMemoryContainmentIndex`.
 */
export interface ContainmentIndex {
  getParent(blockId: BlockId): BlockId | null;
  getChildren(blockId: BlockId): BlockId[];
  /** Returns the full block tree for a document, starting from its root block. */
  getDocumentTree(documentId: DocumentId): ContentBlock[];
  bulkLoad(model: CompiledModel): void;
}

/**
 * In-memory containment index. Parent and children are read from each block's
 * fields; a document's tree is produced by a depth-first traversal from the
 * root block.
 */
export class InMemoryContainmentIndex implements ContainmentIndex {
  private readonly blocksById = new Map<BlockId, ContentBlock>();
  private readonly rootByDocument = new Map<DocumentId, BlockId>();

  bulkLoad(model: CompiledModel): void {
    this.blocksById.clear();
    this.rootByDocument.clear();
    for (const block of model.blocks) {
      this.blocksById.set(block.id, block);
      if (block.parent === null) {
        this.rootByDocument.set(block.document, block.id);
      }
    }
  }

  getParent(blockId: BlockId): BlockId | null {
    return this.blocksById.get(blockId)?.parent ?? null;
  }

  getChildren(blockId: BlockId): BlockId[] {
    return this.blocksById.get(blockId)?.children ?? [];
  }

  getDocumentTree(documentId: DocumentId): ContentBlock[] {
    const rootId = this.rootByDocument.get(documentId);
    if (!rootId) return [];
    const tree: ContentBlock[] = [];
    const walk = (id: BlockId): void => {
      const block = this.blocksById.get(id);
      if (!block) return;
      tree.push(block);
      for (const child of block.children) walk(child);
    };
    walk(rootId);
    return tree;
  }
}
