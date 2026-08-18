/**
 * @darkling/knowledge-base — the compiled content model, content-first
 * retrieval library, and service-bus integration.
 *
 * @see specs/content-model.spec.md
 * @see specs/content-first-retrieval.spec.md
 */

export type {
  BlockId,
  CompiledModel,
  CompilationReport,
  ContentBlock,
  Document,
  DocumentId,
  Relationship,
  RelationshipType,
  Slug,
} from './model.js';

export {
  RELATIONSHIP_TYPES,
  asBlockId,
  asDocumentId,
  asSlug,
  isRelationshipType,
} from './model.js';

export type {
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

export { DEFAULT_RETRIEVAL_POLICY } from './retrieval-types.js';

export type {
  FilterableBlockProperty,
  FilterableDocumentProperty,
  MatchSemantics,
  PropertySchema,
} from './property-schema.js';

export {
  DEFAULT_PROPERTY_SCHEMA,
  isFilterableBlockProperty,
  isFilterableDocumentProperty,
} from './property-schema.js';

export type { BlockStore } from './store.js';
export { InMemoryBlockStore } from './store.js';

export type { PropertyIndex } from './property-index.js';
export { InMemoryPropertyIndex, NonFilterablePropertyError } from './property-index.js';

export type { TextHit, TextIndex } from './text-index.js';
export { InMemoryTextIndex } from './text-index.js';

export type { IndexedRelationship, RelationshipIndex } from './relationship-index.js';
export { InMemoryRelationshipIndex } from './relationship-index.js';

export type { ContainmentIndex } from './containment-index.js';
export { InMemoryContainmentIndex } from './containment-index.js';

export { createInMemoryStores, type InMemoryStores } from './in-memory-stores.js';

export { RetrievalEngine } from './retrieval-engine.js';

export {
  KnowledgeBaseService,
  type KnowledgeBaseServiceOptions,
  type KnowledgeBaseDeclaration,
} from './service-implementation.js';

export { knowledgeBaseServiceDeclaration } from './service-declaration.js';
