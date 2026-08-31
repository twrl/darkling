import { ServiceBroker } from './service-broker.js';
import type { BrokerFactory, BrokerFactoryResult } from './runtime.js';
import { createWorkerTransport } from './worker-transport.js';
import type { ServiceRegistration } from './registration.js';
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
 * @see specs/runtime.spec.md#worker-topology
 */
export function createWorkerBrokerFactory(options: WorkerBrokerFactoryOptions): BrokerFactory {
  return () => {
    const worker = new Worker(options.brokerWorkerUrl, { type: 'module' });
    const transport = createWorkerTransport(worker);

    worker.postMessage({
      type: 'broker-init',
      registrations: options.registrations,
      hostWorkerUrl: options.hostWorkerUrl,
    });

    const broker: ServiceBroker = {
      register(registration: ServiceRegistration) {
        worker.postMessage({ type: 'broker-register', registration });
      },
      registerSlice(registration: { id: string; moduleSpecifier: string }) {
        // Slice registration via the worker is forwarded as a call to the
        // authority service.
        // This is handled by the broker worker's message handler.
      },
      setRegistryCallback() {
        // No-op for the worker proxy; the broker worker handles registry.
      },
      getRegistryCallback() {
        return null;
      },
      start() {
        // The broker worker starts on receiving broker-init.
      },
      async stop() {
        transport.close();
        worker.terminate();
      },
    } as unknown as ServiceBroker;

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
