/**
 * Broker worker entry point. This module runs inside a dedicated Web Worker.
 *
 * The main thread creates the worker with `new Worker(brokerWorkerUrl)`, then
 * sends a {@link BrokerWorkerInit} message containing service registrations
 * and the host worker URL. The broker worker:
 *
 * 1. Creates a `ServiceModuleRegistry` and registers all services.
 * 2. Creates a `WorkerHostSpawner` with the host worker URL.
 * 3. Creates a `ServiceBroker` wired to a `createWorkerTransport(self)` (the
 *    transport back to the main thread's `ServiceClient`).
 * 4. Starts the broker.
 *
 * From that point on, the broker routes `call`/`return`/`error` envelopes
 * between the client (main thread) and hosts (spawned host workers).
 *
 * @see specs/service-bus.spec.md#servicebroker
 * @see specs/service-bus.spec.md#worker-topology
 */

/// <reference lib="webworker" />

import { ServiceBroker } from './service-broker.js';
import { ServiceModuleRegistry } from './service-module-registry.js';
import { WorkerHostSpawner } from './worker-host-spawner.js';
import { createWorkerTransport } from './worker-transport.js';
import { isBrokerWorkerInit, isBrokerWorkerRegister } from './worker-protocol.js';

let broker: ServiceBroker | null = null;
let registry: ServiceModuleRegistry | null = null;

const transport = createWorkerTransport(self as unknown as Worker);

self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (isBrokerWorkerInit(msg) && !broker) {
    registry = new ServiceModuleRegistry();
    for (const registration of msg.registrations) {
      registry.register(registration);
    }
    const spawner = new WorkerHostSpawner({ hostWorkerUrl: msg.hostWorkerUrl });
    broker = new ServiceBroker(transport, spawner, registry);
    broker.start();
  } else if (isBrokerWorkerRegister(msg) && registry) {
    registry.register(msg.registration);
  }
  // After init, all other messages are Envelopes handled by the broker's
  // transport listener.
});
