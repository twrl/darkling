import type { ServiceId } from './envelope.js';
import type { ModuleSpecifier } from './service-module-registry.js';
import type { Transport } from './transport.js';

/**
 * A launched host: its transport (connected to the broker) and the set of
 * service IDs it has been asked to activate.
 */
export interface LaunchedHost {
  /** Transport endpoint on the broker side, connected to the host. */
  transport: Transport;
  /** Service IDs that this host will activate. */
  serviceIds: string[];
}

/**
 * A serializable request to launch a host for a set of services. The spawner
 * receives the service ID and module specifier — the serializable handle from
 * which the live declaration and implementation can be loaded by importing
 * the module. The spawner resolves the implementations itself.
 *
 * @see specs/service-bus.spec.md#on-demand-activation
 */
export interface HostLaunchRequest {
  /** The service identifier. */
  serviceId: ServiceId;
  /** The module specifier from which the declaration and implementation can be loaded. */
  moduleSpecifier: ModuleSpecifier;
  /**
   * Optional serialisable construction options for the service, forwarded to
   * the host worker and merged into the `HostContext` under a key matching
   * the service ID. Must be structured-cloneable.
   */
  options?: Record<string, unknown>;
}

/**
 * A factory that launches a `ServiceHost` for the given services.
 *
 * The broker uses a `HostSpawner` to launch hosts on demand. The spawner
 * resolves service declarations and implementations from the provided module
 * specifiers — for the in-process spawner, via a factory map; for a worker
 * spawner, via dynamic import. The specific mechanism is an implementation
 * concern of the spawner.
 *
 * @see specs/service-bus.spec.md#on-demand-activation
 */
export interface HostSpawner {
  /**
   * Launch a new host capable of executing the given services. The spawner
   * resolves and activates the services on the host and returns a transport
   * endpoint connected to the host.
   */
  launch(services: HostLaunchRequest[]): Promise<LaunchedHost>;
}
