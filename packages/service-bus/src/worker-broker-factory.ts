import { ServiceBroker } from './service-broker.js';
import type { BrokerFactory, BrokerFactoryResult } from './service-bus.js';
import { createWorkerTransport } from './worker-transport.js';
import type { ServiceRegistration } from './service-module-registry.js';
import type { WorkerUrl } from './worker-protocol.js';

/**
 * Options for creating a {@link WorkerBrokerFactory}.
 */
export interface WorkerBrokerFactoryOptions {
  /** The URL of the broker worker entry point. */
  brokerWorkerUrl: WorkerUrl;
  /** The URL of the host worker entry point, forwarded to the broker worker. */
  hostWorkerUrl: WorkerUrl;
  /** Service registrations to send to the broker worker at init time. */
  registrations: ServiceRegistration[];
}

/**
 * A `BrokerFactory` that runs the `ServiceBroker` in a dedicated Web Worker.
 *
 * The factory:
 *
 * 1. Creates a `new Worker(brokerWorkerUrl)`.
 * 2. Wraps the worker in a `createWorkerTransport` — this is the single
 *    transport that both the `ServiceClient` (main thread) and the broker
 *    worker use to communicate. The `ServiceClient` sends envelopes through
 *    it; the broker worker receives them via its own `createWorkerTransport(self)`.
 * 3. Sends a `BrokerWorkerInit` message with the service registrations and
 *    the host worker URL.
 * 4. Returns a `BrokerFactoryResult` with the worker transport as the
 *    `clientTransport` and a broker proxy.
 *
 * The returned `ServiceBroker` is a lightweight proxy; the real broker runs
 * inside the worker. The proxy forwards `register()` calls to the broker
 * worker via `postMessage` (as `BrokerWorkerRegister` control messages), and
 * `stop()` terminates the worker.
 *
 * @see specs/service-bus.spec.md#worker-topology
 */
export function createWorkerBrokerFactory(options: WorkerBrokerFactoryOptions): BrokerFactory {
  return () => {
    const worker = new Worker(options.brokerWorkerUrl, { type: 'module' });
    const transport = createWorkerTransport(worker);

    // Send the init message with registrations and the host worker URL.
    worker.postMessage({
      type: 'broker-init',
      registrations: options.registrations,
      hostWorkerUrl: options.hostWorkerUrl,
    });

    const broker: ServiceBroker = {
      register(registration) {
        worker.postMessage({ type: 'broker-register', registration });
      },
      start() {
        // The broker worker starts on receiving broker-init; no-op for the proxy.
      },
      async stop() {
        transport.close();
        worker.terminate();
      },
    } as ServiceBroker;

    const result: BrokerFactoryResult = {
      broker,
      clientTransport: transport,
      dispose: async () => {
        transport.close();
        worker.terminate();
      },
    };
    return result;
  };
}
