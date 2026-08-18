/**
 * The knowledge-base retrieval service implementation. Owns a `RetrievalEngine`
 * and dispatches retrieval function calls to it.
 *
 * This module is loaded lazily by the service declaration's
 * `implementationLoader`, via dynamic `import()`, so that the implementation
 * is kept out of the initial bundle and loaded on demand by the host worker.
 *
 * @see specs/service-bus.spec.md#service-interface-contract
 */

import type { HostContext, ServiceCallContext, ServiceDeclaration } from '@darkling/service-bus';
import { ServiceImplementation } from '@darkling/service-bus';
import { RetrievalEngine } from './retrieval-engine.js';
import { asBlockId, asDocumentId, asSlug } from './model.js';
import { createInMemoryStores } from './in-memory-stores.js';
import type { InMemoryStores } from './in-memory-stores.js';
import type { CompiledModel } from './model.js';
import type { RetrievalPolicy } from './retrieval-types.js';
import { DEFAULT_RETRIEVAL_POLICY } from './retrieval-types.js';

/**
 * Options for the knowledge-base service, carried by the `HostContext`.
 * Allows the host to inject store configuration (in-memory for tests, a
 * Redis-backed store for production) and the retrieval policy.
 */
export interface KnowledgeBaseServiceOptions {
  /**
   * A factory for the store/index bundle, or an existing bundle. If omitted,
   * an in-memory bundle is created. The factory is invoked in the service
   * constructor.
   */
  stores?: InMemoryStores | (() => InMemoryStores);
  /** The compiled model to load into the stores on activation. */
  model?: CompiledModel;
  /** The retrieval policy. Defaults to `DEFAULT_RETRIEVAL_POLICY`. */
  policy?: RetrievalPolicy;
}

/**
 * The knowledge-base service's function names, used to type the
 * `ServiceImplementation` generic parameter.
 */
export type KnowledgeBaseDeclaration = ServiceDeclaration & {
  functions: {
    getDocumentsById: unknown;
    getBlocksById: unknown;
    getDocumentBySlug: unknown;
    queryDocuments: unknown;
    queryBlocks: unknown;
    searchBlocks: unknown;
    searchDocuments: unknown;
    traverseOutbound: unknown;
    traverseInbound: unknown;
  };
};

/**
 * The knowledge-base service implementation. Owns a `RetrievalEngine` and
 * dispatches retrieval function calls to it.
 */
export class KnowledgeBaseService extends ServiceImplementation<KnowledgeBaseDeclaration> {
  private readonly engine: RetrievalEngine;

  constructor(hostContext: HostContext) {
    super(hostContext);
    const options =
      (
        hostContext as HostContext & {
          knowledgeBase?: KnowledgeBaseServiceOptions;
        }
      ).knowledgeBase ?? {};
    const stores = options.stores
      ? typeof options.stores === 'function'
        ? options.stores()
        : options.stores
      : createInMemoryStores();
    if (options.model) stores.load(options.model);
    this.engine = new RetrievalEngine(
      stores.blockStore,
      stores.propertyIndex,
      stores.textIndex,
      stores.relationshipIndex,
      stores.containmentIndex,
      options.policy ?? DEFAULT_RETRIEVAL_POLICY,
    );
  }

  async invoke(
    functionName: string,
    params: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ServiceCallContext,
  ): Promise<unknown> {
    switch (functionName) {
      case 'getDocumentsById': {
        const p = params as { ids: string[] };
        return this.engine.getDocumentsById(p.ids.map(asDocumentId));
      }
      case 'getBlocksById': {
        const p = params as { ids: string[] };
        return this.engine.getBlocksById(p.ids.map(asBlockId));
      }
      case 'getDocumentBySlug': {
        const p = params as { slug: string };
        return this.engine.getDocumentBySlug(asSlug(p.slug));
      }
      case 'queryDocuments': {
        const p = params as {
          criteria: Array<{ property: string; value: string }>;
          page?: { limit?: number; cursor?: string };
        };
        return this.engine.queryDocuments(p.criteria, p.page);
      }
      case 'queryBlocks': {
        const p = params as {
          criteria: Array<{ property: string; value: string }>;
          page?: { limit?: number; cursor?: string };
        };
        return this.engine.queryBlocks(p.criteria, p.page);
      }
      case 'searchBlocks': {
        const p = params as { query: string; page?: { limit?: number; cursor?: string } };
        return this.engine.searchBlocks(p.query, p.page);
      }
      case 'searchDocuments': {
        const p = params as { query: string; page?: { limit?: number; cursor?: string } };
        return this.engine.searchDocuments(p.query, p.page);
      }
      case 'traverseOutbound': {
        const p = params as {
          blockId: string;
          typeFilter?: string;
          page?: { limit?: number; cursor?: string };
        };
        return this.engine.traverseOutbound(asBlockId(p.blockId), p.typeFilter as never, p.page);
      }
      case 'traverseInbound': {
        const p = params as {
          blockId: string;
          typeFilter?: string;
          page?: { limit?: number; cursor?: string };
        };
        return this.engine.traverseInbound(asBlockId(p.blockId), p.typeFilter as never, p.page);
      }
      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }
}
