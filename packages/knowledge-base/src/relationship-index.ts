/**
 * Relationship index — supports relationship traversal. Indexes outbound and
 * inbound relationships and supports filtering by relationship type.
 *
 * @see specs/content-first-retrieval.spec.md#storage-and-indexing
 */

import type { CompiledModel, BlockId, ContentBlock, RelationshipType } from './model.js';

/**
 * An indexed relationship entry: the related block ID and the relationship type.
 */
export interface IndexedRelationship {
  blockId: BlockId;
  type: RelationshipType;
}

/**
 * The relationship index interface. Platform-neutral; an in-memory reference
 * implementation is provided by `InMemoryRelationshipIndex`.
 */
export interface RelationshipIndex {
  traverseOutbound(blockId: BlockId, typeFilter?: RelationshipType): IndexedRelationship[];
  traverseInbound(blockId: BlockId, typeFilter?: RelationshipType): IndexedRelationship[];
  bulkLoad(model: CompiledModel): void;
}

/**
 * In-memory relationship index. Outbound relationships are read from each
 * block's `relationships` array; inbound relationships are built into a
 * reverse map during `bulkLoad`.
 */
export class InMemoryRelationshipIndex implements RelationshipIndex {
  private readonly outbound = new Map<BlockId, IndexedRelationship[]>();
  private readonly inbound = new Map<BlockId, IndexedRelationship[]>();

  bulkLoad(model: CompiledModel): void {
    this.outbound.clear();
    this.inbound.clear();
    for (const block of model.blocks) {
      const outs: IndexedRelationship[] = block.relationships.map((r) => ({
        blockId: r.target,
        type: r.type,
      }));
      this.outbound.set(block.id, outs);
      for (const r of block.relationships) {
        const ins = this.inbound.get(r.target) ?? [];
        ins.push({ blockId: block.id, type: r.type });
        this.inbound.set(r.target, ins);
      }
    }
  }

  traverseOutbound(blockId: BlockId, typeFilter?: RelationshipType): IndexedRelationship[] {
    const all = this.outbound.get(blockId) ?? [];
    return typeFilter ? all.filter((r) => r.type === typeFilter) : all;
  }

  traverseInbound(blockId: BlockId, typeFilter?: RelationshipType): IndexedRelationship[] {
    const all = this.inbound.get(blockId) ?? [];
    return typeFilter ? all.filter((r) => r.type === typeFilter) : all;
  }
}

/** Re-exported for the retrieval engine. */
export type { ContentBlock };
