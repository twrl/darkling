import type { z } from 'zod';

import type { ServiceId } from './envelope.js';
import type { ServiceImplementation } from './service-implementation.js';

/**
 * A service function declaration. The parameter and return types are expressed
 * using Zod 4 schemas.
 *
 * @see specs/service-bus.spec.md#service-interface-contract
 */
export interface ServiceFunctionDeclaration<
  TParams extends z.ZodType = z.ZodType,
  TReturn extends z.ZodType = z.ZodType,
> {
  /** The parameter schema for this function. */
  params: TParams;
  /** The return value schema for this function. */
  returns: TReturn;
  /** The cost of dispatching this function call, as defined by Event system budget policy. */
  cost?: number;
  /** Human-readable description of this function, used in tool definitions sent to the model. */
  description?: string;
}

/**
 * A service declaration — interface and metadata separate from implementation.
 * Registered with the broker; the implementation runs on a host.
 *
 * @see specs/service-bus.spec.md#service-registration
 */
export interface ServiceDeclaration {
  /** A unique name for the service. */
  id: ServiceId;
  /** The functions exposed by this service, keyed by function name. */
  functions: Record<string, ServiceFunctionDeclaration>;
  /**
   * A function that asynchronously loads and returns the service's
   * implementation class, typically via dynamic `import()`.
   *
   * The loader is called lazily — only when a host needs to activate the
   * service. The host instantiates the returned class, passing it a
   * `HostContext` that provides access to the bus (e.g. a service client for
   * service-to-service calls). This keeps the implementation module out of the
   * initial bundle and allows it to be loaded on demand.
   *
   * The loader returns a _constructor_ (class), not an instance. The host
   * creates the instance so it can inject the `HostContext` at construction
   * time.
   *
   * The loader is a function and therefore not serializable across
   * `postMessage`. The declaration is never sent across a worker boundary;
   * each worker imports the declaration module itself to obtain its own
   * instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-explicit-any
  implementationLoader: () => Promise<new (hostContext: any) => ServiceImplementation<any>>;
  /** Service-level metadata used by the broker for routing and activation decisions. */
  metadata?: ServiceMetadata;
}

/**
 * Service-level metadata (e.g. cost hints, capabilities, host requirements)
 * used by the broker for routing and activation decisions.
 */
export interface ServiceMetadata {
  /** Capabilities this service provides, used by the broker for host assignment. */
  capabilities?: string[];
  /** Host requirements for this service (e.g. specific APIs, worker config). */
  hostRequirements?: Record<string, unknown>;
  /** Hint for the broker about whether this service should share a host with others. */
  preferSharedHost?: boolean;
}

/**
 * The function-level interface of a service, keyed by function name, with
 * parameter and return types derived from the Zod schemas.
 */
export type ServiceInterface<T extends ServiceDeclaration> = {
  [K in keyof T['functions']]: (
    params: z.infer<T['functions'][K]['params']>,
  ) => Promise<z.infer<T['functions'][K]['returns']>>;
};
