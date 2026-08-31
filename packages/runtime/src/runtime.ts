import type { ServiceDeclaration, ServiceProxy } from './declaration.js';
import { ServiceBroker } from './service-broker.js';
import type { ServiceModuleResolver, HostSpawner } from './service-broker.js';
import { InProcessHostSpawner } from './service-broker.js';
import { RuntimeClient } from './runtime-client.js';
import type { RuntimeClientOptions } from './runtime-client.js';
import { createInProcessTransportPair } from './in-process-transport.js';
import type { Transport } from './transport.js';
import type { ServiceRegistration } from './registration.js';
import type { HostContext } from './service-implementation.js';
import { createWorkerBrokerFactory } from './worker-broker-factory.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('runtime:facade');

/**
 * The result of a {@link BrokerFactory}: the broker and the client transport
 * that the `RuntimeClient` should use to communicate with it.
 */
export interface BrokerFactoryResult {
  /** The broker — a real `ServiceBroker` (in-process) or a proxy (worker). */
  broker: ServiceBroker;
  /** The transport the `RuntimeClient` should use to talk to the broker. */
  clientTransport: Transport;
  /** Called by the facade on dispose to release worker/transport resources. */
  dispose?: () => Promise<void>;
}

/**
 * A factory that creates the broker and the client transport.
 */
export type BrokerFactory = () => BrokerFactoryResult;

/**
 * Options for creating a {@link Runtime}.
 *
 * When omitted, the broker is launched in a dedicated Web Worker using the
 * package's `./broker-worker` and `./host-worker` entry points. This is the
 * only use case outside of testing.
 */
export interface RuntimeOptions {
  /**
   * A factory that constructs the broker. When omitted, the broker is launched
   * in a dedicated Web Worker via {@link createWorkerBrokerFactory}, using the
   * package's built-in worker entry points. For testing, provide
   * {@link createInProcessBrokerFactory}.
   */
  brokerFactory?: BrokerFactory;
  /** Options forwarded to the `RuntimeClient`. */
  clientOptions?: RuntimeClientOptions;
}

/**
 * The main-thread facade for the runtime. It creates and owns the
 * `ServiceBroker`, exposes the `RuntimeClient`, and provides a single entry
 * point for service registration and proxy creation.
 *
 * The facade runs on the main thread. It creates a transport pair: one end
 * for the `RuntimeClient` (on the main thread), one for the broker (which may
 * run in-process or in a dedicated Web Worker). Services are registered via
 * serializable `ServiceRegistration` records; typed proxies are created from
 * live `ServiceDeclaration` objects.
 *
 * @see specs/runtime.spec.md
 */
export class Runtime {
  private readonly broker: ServiceBroker;
  private readonly client: RuntimeClient;
  private readonly clientTransport: Transport;
  private readonly brokerDispose: (() => Promise<void>) | undefined;
  private disposed = false;

  constructor(options: RuntimeOptions = {}) {
    const factory = options.brokerFactory ?? defaultBrokerFactory;
    const result = factory();
    this.broker = result.broker;
    this.clientTransport = result.clientTransport;
    this.brokerDispose = result.dispose;
    this.client = new RuntimeClient(this.clientTransport, options.clientOptions);
    this.broker.start();
  }

  /**
   * Register a service with the broker. Delegates to `RuntimeClient.registerService`.
   */
  async register(registration: ServiceRegistration): Promise<void> {
    // For in-process broker, register directly for synchronous availability.
    // For worker broker, the registration crosses postMessage.
    this.broker.register(registration);
  }

  /** The `RuntimeClient`, for callers who need direct access. */
  get runtimeClient(): RuntimeClient {
    return this.client;
  }

  /**
   * Create a typed proxy for a service from its live declaration.
   */
  proxy<T extends ServiceDeclaration>(
    declaration: T,
  ): T extends { proxyFactory: infer F }
    ? F extends (client: RuntimeClient) => infer R
      ? R
      : ServiceProxy<T>
    : ServiceProxy<T> {
    return this.client.proxy(declaration);
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
  // The default factory launches the broker in a dedicated Web Worker using
  // the package's built-in worker entry points. This is the production path;
  // tests should use createInProcessBrokerFactory instead.
  const factory = createWorkerBrokerFactory({
    brokerWorkerUrl: new URL('./broker-worker.ts', import.meta.url).href,
    hostWorkerUrl: new URL('./host-worker.ts', import.meta.url).href,
    registrations: [],
  });
  return factory();
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
    const broker = new ServiceBroker(brokerTransport, hostContext, { spawner, resolver });
    return { broker, clientTransport };
  };
}

// --- Singleton ---

let singleton: Runtime | null = null;

/**
 * Get the singleton `Runtime` instance, creating it if necessary. When called
 * with no arguments (or when no singleton exists), the broker is launched in a
 * dedicated Web Worker using the package's built-in worker entry points. If a
 * singleton already exists, the options are ignored.
 */
export function getRuntime(options?: RuntimeOptions): Runtime {
  if (!singleton) {
    singleton = new Runtime(options ?? {});
    attachToWindowIfPresent(singleton);
  }
  return singleton;
}

/** Get the existing singleton `Runtime`, or `null` if none has been created. */
export function peekRuntime(): Runtime | null {
  return singleton;
}

/** Dispose and clear the singleton `Runtime`, if one exists. */
export async function resetRuntime(): Promise<void> {
  if (singleton) {
    await singleton.dispose();
    singleton = null;
    attachToWindowIfPresent(null);
  }
}

function attachToWindowIfPresent(runtime: Runtime | null): void {
  try {
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as Record<string, unknown>;
      if ('window' in g || typeof g['window'] !== 'undefined') {
        g['__darklingRuntime'] = runtime ?? undefined;
      }
    }
  } catch {
    // `globalThis` or `window` may be unavailable; ignore.
  }
}
