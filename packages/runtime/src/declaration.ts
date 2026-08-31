import type { z } from 'zod';

import type { ServiceId } from './envelope.js';
import type { ServiceImplementation } from './service-implementation.js';
import type { RuntimeClient } from './runtime-client.js';

/**
 * A service function declaration. The parameter and return types are expressed
 * using Zod 4 schemas.
 *
 * A function is a request/response operation: the caller supplies parameters
 * and receives a result.
 *
 * @see specs/runtime.spec.md#functions
 */
export interface ServiceFunctionDeclaration<
  TParams extends z.ZodType = z.ZodType,
  TReturn extends z.ZodType = z.ZodType,
> {
  /** The parameter schema for this function. */
  params: TParams;
  /** The return value schema for this function. */
  returns: TReturn;
  /** Human-readable description, used in tool definitions sent to the model. */
  description?: string;
}

/**
 * A service behaviour declaration. A behaviour is a fire-and-forget operation:
 * the caller requests that the service perform an operation but does not await
 * a result.
 *
 * @see specs/runtime.spec.md#behaviours
 */
export interface ServiceBehaviourDeclaration<TParams extends z.ZodType = z.ZodType> {
  /** The parameter schema for this behaviour. */
  params: TParams;
  /** Human-readable description. */
  description?: string;
  // no returns field — behaviours do not produce results
}

/**
 * Service-level metadata used by the broker for routing and activation
 * decisions, and governing the service's activation lifecycle.
 *
 * @see specs/runtime.spec.md#service-metadata
 */
export interface ServiceMetadata {
  /**
   * If `true`, the service should be activated on the broker's local host.
   * If `false` or omitted, the broker decides where to place the service.
   * The broker should respect this hint but may override it.
   */
  onBroker?: boolean;
  /** Capabilities this service provides, for broker host-assignment decisions. */
  capabilities?: string[];
  /** Requirements for this service's host (e.g. specific APIs, worker configuration). */
  hostRequirements?: Record<string, unknown>;
  /**
   * The slice identifiers this service commits mutations to or reads. The host
   * must not transition the service past the `activating_1` state until all
   * listed slices are loaded by the authority.
   *
   * @see specs/runtime.spec.md#initialization
   */
  requiredSlices?: string[];
  /**
   * The name of a behaviour in the `behaviours` map to be delivered as the
   * first invocation to the service once all required slices are available.
   *
   * @see specs/runtime.spec.md#initialization
   */
  initializer?: string;
}

/**
 * A service declaration — interface and metadata separate from implementation.
 * Registered with the broker; the implementation runs on a host.
 *
 * The declaration module must follow the `*.service.ts` naming convention and
 * must export the `ServiceDeclaration` as the default export.
 *
 * @see specs/runtime.spec.md#service-declarations
 */
export interface ServiceDeclaration {
  /** A unique name for the service. */
  id: ServiceId;
  /** The functions exposed by this service, keyed by function name. */
  functions: Record<string, ServiceFunctionDeclaration>;
  /** The behaviours exposed by this service, keyed by behaviour name. Optional. */
  behaviours?: Record<string, ServiceBehaviourDeclaration>;
  /**
   * A function that asynchronously loads and returns the service's
   * implementation class, typically via dynamic `import()`.
   *
   * The loader is called lazily — only when a host needs to activate the
   * service. The host instantiates the returned class, passing it a
   * `HostContext` that provides access to the runtime.
   *
   * The declaration module must not import the implementation module at
   * module-load time; the loader must load the implementation via dynamic
   * `import()`.
   *
   * @see specs/runtime.spec.md#declaration-module-and-implementation-loading
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  implementationLoader: () => Promise<new (hostContext: any) => ServiceImplementation<any>>;
  /** Service-level metadata for routing and activation decisions. */
  metadata?: ServiceMetadata;
  /**
   * An optional proxy factory that produces a custom client-side proxy in place
   * of the default generated proxy.
   *
   * @see specs/runtime.spec.md#proxy-factories
   */
  proxyFactory?: (client: RuntimeClient) => unknown;
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

/**
 * The behaviour-level interface of a service, keyed by behaviour name, with
 * parameter types derived from the Zod schemas. Behaviours return `void`.
 */
export type ServiceBehaviourInterface<T extends ServiceDeclaration> = {
  [K in keyof NonNullable<T['behaviours']>]: (
    params: z.infer<NonNullable<T['behaviours']>[K]['params']>,
  ) => void;
};

/**
 * The full default proxy interface of a service: function methods (returning
 * promises) and behaviour methods (returning void), derived from the service
 * declaration's Zod schemas. This is what the `RuntimeClient` generates when
 * no `proxyFactory` is present.
 */
export type ServiceProxy<T extends ServiceDeclaration> = ServiceInterface<T> &
  ServiceBehaviourInterface<T>;
