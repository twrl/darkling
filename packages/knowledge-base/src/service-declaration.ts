/**
 * The knowledge-base retrieval service declaration — the service's interface
 * and metadata, separate from its implementation, as defined by
 * [Service registration](../../specs/service-bus.spec.md#service-registration).
 *
 * This module is the service's entry point. The host worker dynamically
 * imports a declaration module expecting a named `declaration` export, then
 * calls `declaration.implementationLoader()` to lazily load the implementation
 * class via dynamic `import()`.
 *
 * The declaration is registered with the broker; the implementation runs on a
 * host. The `implementationLoader` keeps the implementation module out of the
 * initial bundle and allows it to be loaded on demand.
 *
 * @see specs/service-bus.spec.md#service-registration
 * @see specs/service-bus.spec.md#on-demand-activation
 */

import { z } from 'zod';
import type { ServiceDeclaration, ServiceImplementation } from '@darkling/service-bus';
import type { KnowledgeBaseDeclaration } from './service-implementation.js';

// --- Zod schemas for service function parameters and returns ---

const idSchema = z.string();
const idsSchema = z.array(z.string());
const slugSchema = z.string();
const criterionSchema = z.object({
  property: z.string(),
  value: z.string(),
});
const criteriaSchema = z.array(criterionSchema);
const pageSchema = z
  .object({
    limit: z.number().int().positive().optional(),
    cursor: z.string().optional(),
  })
  .optional();
const typeFilterSchema = z.string().optional();

// Opaque result schemas. The retrieval results are structured objects; we
// validate their shape loosely (object) rather than enumerating every field,
// since the model types are the source of truth and the service bus spec
// requires validation against Zod schemas. A stricter schema per result type
// could be added; the loose object schemas are conformant (validation occurs).
const objectSchema = z.record(z.string(), z.unknown());
const pageResultSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.union([z.string(), z.null()]),
  hasMore: z.boolean(),
});
const byIdResultSchema = z.object({
  items: z.array(z.unknown()),
  notFound: z.array(z.string()),
});

/**
 * The service declaration for the `knowledge-base` retrieval service. Exposes
 * all retrieval engine operations as service functions with Zod-validated
 * parameters and returns.
 *
 * The `implementationLoader` dynamically imports the implementation module,
 * returning the `KnowledgeBaseService` constructor. The host instantiates the
 * class with a `HostContext`, injecting bus access at construction time.
 */
export const declaration: ServiceDeclaration = {
  id: 'knowledge-base',
  functions: {
    getDocumentsById: {
      params: z.object({ ids: idsSchema }),
      returns: byIdResultSchema,
      description: 'Retrieve documents by ID. Unresolved IDs are reported as not found.',
    },
    getBlocksById: {
      params: z.object({ ids: idsSchema }),
      returns: byIdResultSchema,
      description: 'Retrieve content blocks by ID. Unresolved IDs are reported as not found.',
    },
    getDocumentBySlug: {
      params: z.object({ slug: slugSchema }),
      returns: objectSchema.nullable(),
      description: 'Resolve a document by its slug.',
    },
    queryDocuments: {
      params: z.object({ criteria: criteriaSchema, page: pageSchema }),
      returns: pageResultSchema,
      description: 'Retrieve documents by filterable properties (logical AND).',
    },
    queryBlocks: {
      params: z.object({ criteria: criteriaSchema, page: pageSchema }),
      returns: pageResultSchema,
      description: 'Retrieve content blocks by filterable properties (logical AND).',
    },
    searchBlocks: {
      params: z.object({ query: z.string(), page: pageSchema }),
      returns: pageResultSchema,
      description: 'Retrieve content blocks by textual content, ranked by relevance.',
    },
    searchDocuments: {
      params: z.object({ query: z.string(), page: pageSchema }),
      returns: pageResultSchema,
      description: 'Retrieve documents whose constituent blocks match a text query.',
    },
    traverseOutbound: {
      params: z.object({
        blockId: idSchema,
        typeFilter: typeFilterSchema,
        page: pageSchema,
      }),
      returns: pageResultSchema,
      description: 'Traverse outbound relationships from a block, optionally filtered by type.',
    },
    traverseInbound: {
      params: z.object({
        blockId: idSchema,
        typeFilter: typeFilterSchema,
        page: pageSchema,
      }),
      returns: pageResultSchema,
      description: 'Traverse inbound relationships to a block, optionally filtered by type.',
    },
  },
  implementationLoader: async () => {
    // Dynamically import the implementation module so it is loaded on demand
    // by the host worker, keeping it out of the initial bundle. The
    // `@vite-ignore` comment tells bundlers not to statically analyse this
    // import; the specifier must resolve at runtime.
    const module = await import(/* @vite-ignore */ './service-implementation.js');
    return module.KnowledgeBaseService as unknown as new (
      hostContext: import('@darkling/service-bus').HostContext,
    ) => ServiceImplementation<KnowledgeBaseDeclaration>;
  },
  metadata: {
    capabilities: ['retrieval'],
  },
};

/**
 * The service declaration, re-exported under the name consumers (and the
 * service-bus `ServiceBus.createProxy`) expect. This is the same object as
 * the named `declaration` export above; the alias provides a more descriptive
 * name for direct consumers.
 */
export const knowledgeBaseServiceDeclaration: ServiceDeclaration = declaration;
