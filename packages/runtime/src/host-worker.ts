/**
 * Host worker entry point. This module runs inside a dedicated Web Worker,
 * spawned by the {@link WorkerHostSpawner}.
 *
 * The broker sends a {@link HostWorkerInit} message containing the services
 * to activate (service registrations with module specifiers). The host worker:
 *
 * 1. Dynamically imports each declaration module via `import(moduleSpecifier)`,
 *    obtaining the live `ServiceDeclaration` (with Zod schemas and the
 *    `implementationLoader`).
 * 2. Calls each declaration's `implementationLoader()` to get the
 *    implementation class.
 * 3. Creates a `ServiceHost` with a `HostContext` containing a `RuntimeClient`
 *    wired back to the broker (via `createWorkerTransport(self)`), enabling
 *    service-to-service calls.
 * 4. Activates each service on the host and starts it.
 * 5. Sends a `HostWorkerReady` message back to the broker.
 *
 * From that point on, the host processes `call` and `behaviour` envelopes and
 * sends `return`/`error` envelopes back (for functions).
 *
 * @see specs/runtime.spec.md#servicehost
 * @see specs/runtime.spec.md#worker-topology
 */

/// <reference lib="webworker" />

import { ServiceHost } from './service-host.js';
import { RuntimeClient } from './runtime-client.js';
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
    // The host's RuntimeClient is wired back to the broker via the same
    // transport, enabling service-to-service calls.
    const client = new RuntimeClient(transport);
    const hostContext: HostContext = { client };

    const host = new ServiceHost(transport, hostContext);
    const serviceIds: string[] = [];

    for (const registration of services) {
      // Dynamically import the declaration module to obtain the live
      // ServiceDeclaration (with Zod schemas and the implementationLoader).
      const module = (await import(/* @vite-ignore */ registration.moduleSpecifier)) as {
        default: ServiceDeclaration;
      };
      const declaration = module.default;
      if (!declaration) {
        throw new Error(
          `Module "${registration.moduleSpecifier}" does not export a default declaration`,
        );
      }
      const implementationClass = await declaration.implementationLoader();
      host.activate(declaration, implementationClass);
      serviceIds.push(registration.id);
    }

    host.start();

    const ready: HostWorkerReady = { type: 'host-ready', serviceIds };
    self.postMessage(ready);
  } catch (error) {
    const errorMsg: HostWorkerError = {
      type: 'host-error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(errorMsg);
  }
});
