/**
 * Host worker entry point. This module runs inside a dedicated Web Worker,
 * spawned by the {@link WorkerHostSpawner}.
 *
 * The broker sends a {@link HostWorkerInit} message containing the services
 * to activate (service IDs + module specifiers). The host worker:
 *
 * 1. Dynamically imports each declaration module via `import(moduleSpecifier)`,
 *    obtaining the live `ServiceDeclaration` (with Zod schemas and the
 *    `implementationLoader`).
 * 2. Calls each declaration's `implementationLoader()` to get the
 *    implementation class.
 * 3. Creates a `ServiceHost` with a `HostContext` containing a
 *    `ServiceClient` wired back to the broker (via `createWorkerTransport(self)`),
 *    enabling service-to-service calls.
 * 4. Activates each service on the host and starts it.
 * 5. Sends a `HostWorkerReady` message back to the broker.
 *
 * From that point on, the host processes `call` envelopes and sends
 * `return`/`error` envelopes back.
 *
 * @see specs/service-bus.spec.md#servicehost
 * @see specs/service-bus.spec.md#worker-topology
 */

/// <reference lib="webworker" />

import { ServiceHost } from './service-host.js';
import { ServiceClient } from './service-client.js';
import { createWorkerTransport } from './worker-transport.js';
import type { HostContext } from './service-implementation.js';
import type { ServiceDeclaration } from './declaration.js';
import { isHostWorkerInit, type HostWorkerReady, type HostWorkerError } from './worker-protocol.js';

const transport = createWorkerTransport(self as unknown as Worker);

self.addEventListener('message', async (event: MessageEvent) => {
  const msg = event.data;
  if (!isHostWorkerInit(msg)) return;

  const { services } = msg;

  try {
    // The host's ServiceClient is wired back to the broker via the same
    // transport, enabling service-to-service calls.
    const serviceClient = new ServiceClient(transport);
    const hostContext: HostContext = { serviceClient };

    const host = new ServiceHost(transport, hostContext);
    const serviceIds: string[] = [];

    for (const { serviceId, moduleSpecifier } of services) {
      // Dynamically import the declaration module to obtain the live
      // ServiceDeclaration (with Zod schemas and the implementationLoader).
      // The @vite-ignore comment tells bundlers not to statically analyse
      // this import; the moduleSpecifier must resolve at runtime.
      const module = (await import(/* @vite-ignore */ moduleSpecifier)) as {
        declaration: ServiceDeclaration;
      };
      const declaration = module.declaration;
      if (!declaration) {
        throw new Error(`Module "${moduleSpecifier}" does not export a declaration`);
      }
      const implementationClass = await declaration.implementationLoader();
      host.activate(declaration, implementationClass);
      serviceIds.push(serviceId);
    }

    host.start();

    const ready: HostWorkerReady = { type: 'host-ready', serviceIds };
    self.postMessage(ready);
  } catch (error) {
    const error_msg: HostWorkerError = {
      type: 'host-error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(error_msg);
  }
});
