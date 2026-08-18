/**
 * Factory for a bundle of in-memory store and index implementations.
 *
 * @see specs/content-first-retrieval.spec.md#storage-and-indexing
 */

import { InMemoryBlockStore } from './store.js';
import { InMemoryPropertyIndex } from './property-index.js';
import { InMemoryTextIndex } from './text-index.js';
import { InMemoryRelationshipIndex } from './relationship-index.js';
import { InMemoryContainmentIndex } from './containment-index.js';
import type { BlockStore } from './store.js';
import type { PropertyIndex } from './property-index.js';
import type { TextIndex } from './text-index.js';
import type { RelationshipIndex } from './relationship-index.js';
import type { ContainmentIndex } from './containment-index.js';
import type { CompiledModel } from './model.js';

export interface InMemoryStores {
  blockStore: BlockStore;
  propertyIndex: PropertyIndex;
  textIndex: TextIndex;
  relationshipIndex: RelationshipIndex;
  containmentIndex: ContainmentIndex;
  /** Load a compiled model into all stores and indexes. */
  load(model: CompiledModel): void;
}

/**
 * Create a bundle of in-memory store and index implementations, all empty.
 * Call `load(model)` to populate them from a compiled model.
 */
export const createInMemoryStores = (): InMemoryStores => {
  const blockStore = new InMemoryBlockStore();
  const propertyIndex = new InMemoryPropertyIndex();
  const textIndex = new InMemoryTextIndex();
  const relationshipIndex = new InMemoryRelationshipIndex();
  const containmentIndex = new InMemoryContainmentIndex();
  return {
    blockStore,
    propertyIndex,
    textIndex,
    relationshipIndex,
    containmentIndex,
    load(model: CompiledModel): void {
      blockStore.bulkLoad(model);
      propertyIndex.bulkLoad(model);
      textIndex.bulkLoad(model);
      relationshipIndex.bulkLoad(model);
      containmentIndex.bulkLoad(model);
    },
  };
};
