import type { HostSpawner } from './service-broker.js';
import { createWorkerTransport } from './worker-transport.js';
import type { Transport } from './transport.js';
import { HostUnavailableError } from './errors.js';
import type { ServiceRegistration } from './registration.js';
import type { HostWorkerInit, HostWorkerReady } from './worker-protocol.js';
import { isHostWorkerReady, isHostWorkerError } from './worker-protocol.js';

/**
 * Options for the {@link WorkerHostSpawner}.
 */
export interface WorkerHostSpawnerOptions {
  /** The URL of the host worker entry point (e.g. from `new URL(..., import.meta.url)`). */
  hostWorkerUrl: string;
  /**
   * The name option passed to `new Worker()`. Defaults to no name. Useful for
   * debugging (the worker's name appears in devtools).
   */
  workerName?: string;
}

/**
 * A `HostSpawner` that launches hosts in dedicated Web Workers.
 *
 * For each `launch` call, the spawner:
 *
 * 1. Creates a `new Worker(hostWorkerUrl)`.
 * 2. Sends a `HostWorkerInit` message containing the service registrations.
 * 3. Waits for a `HostWorkerReady` (or `HostWorkerError`) message.
 * 4. Returns a transport endpoint connected to the host worker.
 *
 * @see specs/runtime.spec.md#worker-topology
 */
export class WorkerHostSpawner implements HostSpawner {
  private readonly hostWorkerUrl: string;
  private readonly workerName: string | undefined;

  constructor(options: WorkerHostSpawnerOptions) {
    this.hostWorkerUrl = options.hostWorkerUrl;
    this.workerName = options.workerName;
  }

  async launch(
    services: ServiceRegistration[],
  ): Promise<{ transport: Transport; serviceIds: string[] }> {
    const worker = new Worker(this.hostWorkerUrl, {
      name: this.workerName,
      type: 'module',
    });

    const ready = await this.waitForReady(worker, services);

    const transport: Transport = createWorkerTransport(worker);

    return {
      transport,
      serviceIds: ready.serviceIds,
    };
  }

  private waitForReady(worker: Worker, services: ServiceRegistration[]): Promise<HostWorkerReady> {
    return new Promise<HostWorkerReady>((resolve, reject) => {
      const onMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (isHostWorkerReady(msg)) {
          worker.removeEventListener('message', onMessage);
          resolve(msg);
        } else if (isHostWorkerError(msg)) {
          worker.removeEventListener('message', onMessage);
          worker.terminate();
          reject(new HostUnavailableError(`Host worker error: ${msg.message}`));
        }
      };

      worker.addEventListener('message', onMessage);

      const init: HostWorkerInit = { type: 'host-init', services };
      worker.postMessage(init);

      worker.addEventListener('error', (errorEvent: ErrorEvent) => {
        worker.removeEventListener('message', onMessage);
        reject(new HostUnavailableError(`Host worker failed to start: ${errorEvent.message}`));
      });
    });
  }
}
