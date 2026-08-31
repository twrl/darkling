import type { Envelope } from './envelope.js';
import type { Transport } from './transport.js';

/**
 * Options for creating a worker transport.
 */
export interface WorkerTransportOptions {
  /**
   * A function to extract the transfer list from an outgoing envelope.
   * Defaults to extracting `head.transferables` (but those are path strings;
   * for real Transferable objects the caller must resolve the paths to the
   * actual objects before posting).
   */
  resolveTransferables?: (envelope: Envelope) => Transferable[];
}

/**
 * Create a `Transport` backed by a Web Worker or `MessagePort`.
 *
 * This wraps the underlying `postMessage` channel into our `Transport`
 * interface, handling the `transferables` field in the envelope head as
 * described by the spec.
 *
 * @see specs/runtime.spec.md#transferable-objects
 */
export function createWorkerTransport(
  worker: Worker | MessagePort,
  options: WorkerTransportOptions = {},
): Transport {
  const handlers = new Set<(envelope: Envelope) => void>();
  let closed = false;

  const onMessage = ((event: Event) => {
    if (closed) return;
    const envelope = (event as MessageEvent).data as Envelope;
    for (const handler of handlers) handler(envelope);
  }) as EventListener;

  worker.addEventListener('message', onMessage);

  return {
    send(envelope) {
      if (closed) return;
      const transfer = options.resolveTransferables
        ? options.resolveTransferables(envelope)
        : (envelope.head.transferables as unknown as Transferable[]);
      worker.postMessage(envelope, transfer);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      worker.removeEventListener('message', onMessage);
      handlers.clear();
      if ('terminate' in worker) {
        (worker as Worker).terminate();
      } else {
        (worker as MessagePort).close();
      }
    },
  };
}
