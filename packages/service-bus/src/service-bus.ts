import type { ServiceDeclaration, ServiceInterface } from './declaration.js';
import { ServiceBroker } from './service-broker.js';
import type { ServiceModuleResolver } from './service-broker.js';
import { InProcessHostSpawner } from './service-broker.js';
import { ServiceClient } from './service-client.js';
import type { ServiceClientOptions } from './service-client.js';
import { createInProcessTransportPair } from './in-process-transport.js';
import type { Transport } from './transport.js';
import type { ServiceRegistration } from './service-module-registry.js';
import type { HostContext } from './service-implementation.js';
import type { HostSpawner } from './host-spawner.js';
import { HostUnavailableError } from './errors.js';

/**
 * The result of a {@link BrokerFactory}: the broker (which may run in-process
 * or in a worker) and the client transport that the `ServiceClient` should use
 * to communicate with it.
 */
export interface BrokerFactoryResult {
  /** The broker — a real `ServiceBroker` (in-process) or a proxy (worker). */
  broker: ServiceBroker;
  /** The transport the `ServiceClient` should use to talk to the broker. */
  clientTransport: Transport;
  /** Called by the facade on dispose to release worker/transport resources. */
  dispose?: () => Promise<void>;
}

/**
 * A factory that creates the broker and the client transport. The `ServiceBus`
 * facade uses this to construct the broker — in-process by default, or in a
 * Web Worker when a worker-based factory is provided.
 *
 * The factory owns the transport creation and the host spawner: for the
 * in-process case it creates a transport pair and an `InProcessHostSpawner`;
 * for the worker case it creates a `Worker` and the broker worker creates its
 * own `WorkerHostSpawner`. The facade does not deal with spawners — they are
 * a broker implementation detail.
 */
export type BrokerFactory = () => BrokerFactoryResult;

/**
 * Options for creating a {@link ServiceBus}.
 */
export interface ServiceBusOptions {
  /**
   * A factory that constructs the broker. Defaults to an in-process
   * `ServiceBroker`. Provide a worker-based factory (via
   * `createWorkerBrokerFactory`) to run the broker in a dedicated Web Worker.
   */
  brokerFactory?: BrokerFactory;
  /** Options forwarded to the `ServiceClient`. */
  clientOptions?: ServiceClientOptions;
}

/**
 * The main-thread facade for the service bus. It creates and owns the
 * `ServiceBroker`, exposes the `ServiceClient`, and provides a single entry
 * point for service registration and proxy creation.
 *
 * The facade runs on the main thread. It creates a transport pair: one end
 * for the `ServiceClient` (on the main thread), one for the broker (which
 * may run in-process or in a dedicated Web Worker, depending on the
 * `brokerFactory`). Services are registered via serializable
 * `ServiceRegistration` records; typed proxies are created from live
 * `ServiceDeclaration` objects, which the consumer imports on the main
 * thread.
 *
 * @see specs/service-bus.spec.md
 */
export class ServiceBus {
  private readonly broker: ServiceBroker;
  private readonly client: ServiceClient;
  private readonly clientTransport: Transport;
  private readonly brokerDispose: (() => Promise<void>) | undefined;
  private disposed = false;

  constructor(options: ServiceBusOptions) {
    const factory = options.brokerFactory ?? defaultBrokerFactory;
    const result = factory();
    this.broker = result.broker;
    this.clientTransport = result.clientTransport;
    this.brokerDispose = result.dispose;
    this.client = new ServiceClient(this.clientTransport, options.clientOptions);
    this.broker.start();
  }

  /**
   * Register a service with the broker. The registration record is
   * serializable (ID + module specifier + metadata), so it can be forwarded
   * to a broker running in a Web Worker.
   */
  register(registration: ServiceRegistration): void {
    this.broker.register(registration);
  }

  /** The `ServiceClient`, for callers who need direct access. */
  get serviceClient(): ServiceClient {
    return this.client;
  }

  /**
   * Create a typed, validating proxy for a service from its live declaration.
   * The consumer imports the declaration module on the main thread to obtain
   * the live Zod schemas needed for proxy typing and validation.
   */
  createProxy<T extends ServiceDeclaration>(declaration: T): ServiceInterface<T> {
    return this.client.createProxy(declaration);
  }

  /** Stop the broker and dispose the client, releasing all resources. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.client.dispose();
    await this.broker.stop();
    if (this.brokerDispose) await this.brokerDispose();
    this.clientTransport.close();
  }
}

const defaultBrokerFactory: BrokerFactory = () => {
  const { a: clientTransport, b: brokerTransport } = createInProcessTransportPair();
  // The default factory creates a broker with a spawner that always fails,
  // since without a resolver there is no way to resolve implementations.
  // Consumers must provide a factory (e.g. createInProcessBrokerFactory for
  // tests, createWorkerBrokerFactory for production).
  const spawner: HostSpawner = {
    async launch() {
      throw new HostUnavailableError(
        'No broker factory provided. Use createInProcessBrokerFactory for tests or createWorkerBrokerFactory for production.',
      );
    },
  };
  const broker = new ServiceBroker(brokerTransport, spawner);
  return { broker, clientTransport };
};

/**
 * Create an in-process `BrokerFactory` for testing. The factory creates an
 * `InProcessHostSpawner` with the given resolver and host context.
 */
export function createInProcessBrokerFactory(
  resolver: ServiceModuleResolver,
  hostContext: HostContext,
): BrokerFactory {
  return () => {
    const { a: clientTransport, b: brokerTransport } = createInProcessTransportPair();
    const spawner = new InProcessHostSpawner(resolver, hostContext);
    const broker = new ServiceBroker(brokerTransport, spawner);
    return { broker, clientTransport };
  };
}

// --- Singleton ---

let singleton: ServiceBus | null = null;

/**
 * Get the singleton `ServiceBus` instance, creating it if necessary with the
 * provided options. If a singleton already exists, the options are ignored.
 *
 * When `window` is present (browser environment), the singleton is also
 * attached as `window.__darklingServiceBus` for convenient access.
 */
export function getServiceBus(options: ServiceBusOptions): ServiceBus {
  if (!singleton) {
    singleton = new ServiceBus(options);
    attachToWindowIfPresent(singleton);
  }
  return singleton;
}

/** Get the existing singleton `ServiceBus`, or `null` if none has been created. */
export function peekServiceBus(): ServiceBus | null {
  return singleton;
}

/** Dispose and clear the singleton `ServiceBus`, if one exists. */
export async function resetServiceBus(): Promise<void> {
  if (singleton) {
    await singleton.dispose();
    singleton = null;
    attachToWindowIfPresent(null);
  }
}

function attachToWindowIfPresent(bus: ServiceBus | null): void {
  try {
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as Record<string, unknown>;
      if ('window' in g || typeof g['window'] !== 'undefined') {
        g['__darklingServiceBus'] = bus ?? undefined;
      }
    }
  } catch {
    // `globalThis` or `window` may be unavailable; ignore.
  }
}
