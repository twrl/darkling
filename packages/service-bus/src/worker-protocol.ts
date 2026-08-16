import type { ServiceRegistration } from './service-module-registry.js';
import type { HostLaunchRequest } from './host-spawner.js';

/**
 * The URL of the host worker entry point, to be spawned by the broker's host
 * spawner. This is sent to the broker worker at init time so it can create
 * the `WorkerHostSpawner` with the correct URL.
 */
export type WorkerUrl = string;

/**
 * A bootstrap message sent from the main thread to the broker worker to
 * initialise it. This is the first message the broker worker receives.
 *
 * @see specs/service-bus.spec.md#worker-topology
 */
export interface BrokerWorkerInit {
  /** The type tag identifying this as a broker init message. */
  type: 'broker-init';
  /** Service registrations — serializable records (ID + module specifier + metadata). */
  registrations: ServiceRegistration[];
  /** The URL of the host worker entry point that the broker will spawn. */
  hostWorkerUrl: WorkerUrl;
}

/**
 * A bootstrap message sent from the broker to a host worker to initialise it.
 * This is the first message the host worker receives.
 *
 * @see specs/service-bus.spec.md#worker-topology
 */
export interface HostWorkerInit {
  /** The type tag identifying this as a host init message. */
  type: 'host-init';
  /** The services to activate on this host. */
  services: HostLaunchRequest[];
}

/**
 * A message sent from the host worker back to the broker to signal that it
 * has finished activating services and is ready to receive calls.
 */
export interface HostWorkerReady {
  /** The type tag identifying this as a host ready message. */
  type: 'host-ready';
  /** The service IDs that were activated. */
  serviceIds: string[];
}

/**
 * A message sent from the host worker back to the broker to signal that
 * activation failed.
 */
export interface HostWorkerError {
  /** The type tag identifying this as a host error message. */
  type: 'host-error';
  /** A description of the error. */
  message: string;
  /** The service ID that failed, if applicable. */
  serviceId?: string;
}

/**
 * A bootstrap or control message exchanged between the main thread, broker
 * worker, and host workers — distinct from the `Envelope` messages that carry
 * service calls and returns.
 */
export type WorkerControlMessage =
  BrokerWorkerInit | HostWorkerInit | HostWorkerReady | HostWorkerError;

/**
 * A message sent from the main thread to the broker worker to register an
 * additional service after initialisation.
 */
export interface BrokerWorkerRegister {
  /** The type tag identifying this as a broker register message. */
  type: 'broker-register';
  /** The service registration to add. */
  registration: ServiceRegistration;
}

/** Type guard for `BrokerWorkerRegister`. */
export function isBrokerWorkerRegister(msg: unknown): msg is BrokerWorkerRegister {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'broker-register'
  );
}

/** Type guard for `BrokerWorkerInit`. */
export function isBrokerWorkerInit(msg: unknown): msg is BrokerWorkerInit {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'broker-init'
  );
}

/** Type guard for `HostWorkerInit`. */
export function isHostWorkerInit(msg: unknown): msg is HostWorkerInit {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'host-init'
  );
}

/** Type guard for `HostWorkerReady`. */
export function isHostWorkerReady(msg: unknown): msg is HostWorkerReady {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'host-ready'
  );
}

/** Type guard for `HostWorkerError`. */
export function isHostWorkerError(msg: unknown): msg is HostWorkerError {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'host-error'
  );
}
