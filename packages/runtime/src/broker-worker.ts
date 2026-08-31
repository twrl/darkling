/**
 * Broker worker entry point. This module runs inside a dedicated Web Worker.
 *
 * The main thread creates the worker with `new Worker(brokerWorkerUrl)`, then
 * sends a {@link BrokerWorkerInit} message containing service registrations
 * and the host worker URL. The broker worker:
 *
 * 1. Creates a `ServiceBroker` wired to a `createWorkerTransport(self)`.
 * 2. Registers all services.
 * 3. Starts the broker.
 *
 * From that point on, the broker routes `call`/`behaviour`/`return`/`error`
 * envelopes between the client (main thread) and hosts (spawned host workers).
 *
 * @see specs/runtime.spec.md#servicebroker
 * @see specs/runtime.spec.md#worker-topology
 */

/// <reference lib="webworker" />

import { ServiceBroker } from './service-broker.js';
import { WorkerHostSpawner } from './worker-host-spawner.js';
import { createWorkerTransport } from './worker-transport.js';
import { isBrokerWorkerInit, isBrokerWorkerRegister } from './worker-protocol.js';
import { RuntimeClient } from './runtime-client.js';
import type { HostContext } from './service-implementation.js';

let broker: ServiceBroker | null = null;

const transport = createWorkerTransport(self as unknown as Worker);

self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data;
  if (isBrokerWorkerInit(msg) && !broker) {
    // The broker's local host context: a RuntimeClient wired back to the
    // main thread via the transport. Colocated services use this to call
    // other services.
    const client = new RuntimeClient(transport);
    const hostContext: HostContext = { client };

    const spawner = new WorkerHostSpawner({ hostWorkerUrl: msg.hostWorkerUrl });
    broker = new ServiceBroker(transport, hostContext, { spawner });
    broker.start();
    for (const registration of msg.registrations) {
      broker.register(registration);
    }
  } else if (isBrokerWorkerRegister(msg) && broker) {
    broker.register(msg.registration);
  }
  // After init, all other messages are Envelopes handled by the broker's
  // transport listener.
});
