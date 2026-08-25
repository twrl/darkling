import type { ServiceId } from './envelope.js';
import type { ServiceMetadata } from './declaration.js';

/**
 * A module specifier — a URL or path string resolvable by `import()`. The
 * module exports a {@link ServiceDeclaration} (interface and metadata, with
 * live Zod schemas) and a {@link ServiceImplementation}. Each worker that
 * needs the live objects imports the module itself; the specifier is the
 * serializable handle that crosses `postMessage` boundaries.
 *
 * @see specs/service-bus.spec.md#service-registration
 */
export type ModuleSpecifier = string;

/**
 * A serializable service registration record. This is the data that crosses
 * `postMessage` from the main thread to the broker worker.
 *
 * It contains only structured-cloneable fields: the service ID, the module
 * specifier from which the declaration and implementation can be loaded, and
 * the plain-data metadata used by the broker for routing and activation
 * decisions. It does **not** contain the live {@link ServiceDeclaration} (with
 * Zod schemas) or the implementation — those are obtained by importing the
 * module in whichever worker needs them.
 *
 * @see specs/service-bus.spec.md#interface-and-metadata-separate-from-implementation
 */
export interface ServiceRegistration {
  /** A unique name for the service. */
  id: ServiceId;
  /** The module specifier from which the declaration and implementation can be loaded. */
  moduleSpecifier: ModuleSpecifier;
  /** Service-level metadata used by the broker for routing and activation. */
  metadata?: ServiceMetadata; /**
   * Optional serialisable construction options for the service. These cross
   * `postMessage` to the host worker and are merged into the `HostContext`
   * under a key matching the service ID, so the service implementation can
   * read them at construction time. Must be structured-cloneable; non-
   * serialisable values (functions, live Zod schemas) must not be placed
   * here — the worker builds those from this config.
   */
  options?: Record<string, unknown>;
}

/**
 * The service registration registry — the source of truth for service IDs and
 * the module specifiers from which their declarations and implementations can
 * be loaded. The broker holds this registry.
 *
 * The registry holds only serializable registration records. Live
 * {@link ServiceDeclaration}s (with Zod schemas) are not held by the broker;
 * they are obtained by importing the module in the host worker, which also
 * performs validation. This keeps the broker free of non-serializable objects
 * and allows it to run in a Web Worker receiving registrations via
 * `postMessage`.
 *
 * @see specs/service-bus.spec.md#service-registration
 */
export class ServiceModuleRegistry {
  private readonly registrations = new Map<ServiceId, ServiceRegistration>();

  /**
   * Register a service: its ID, module specifier, and metadata. Each service
   * must be registered before it can be invoked.
   */
  register(registration: ServiceRegistration): void {
    this.registrations.set(registration.id, registration);
  }

  /** Look up a service registration by service ID. */
  get(serviceId: string): ServiceRegistration | undefined {
    return this.registrations.get(serviceId);
  }

  /** Whether a service is registered. */
  has(serviceId: string): boolean {
    return this.registrations.has(serviceId);
  }

  /** All registered service registrations. */
  values(): IterableIterator<ServiceRegistration> {
    return this.registrations.values();
  }
}
