import type { Envelope } from './envelope.js';
import type { Transport, TransportPair } from './transport.js';

/**
 * An in-process transport pair — two `Transport` endpoints connected by an
 * event queue. Messages sent on one end are received on the other, after the
 * current execution context completes (microtask ordering).
 *
 * This is used for testing and for the in-process host spawner; it is not
 * intended for production use where real Web Worker isolation is required.
 */
export function createInProcessTransportPair(): TransportPair {
  const aHandlers = new Set<(envelope: Envelope) => void>();
  const bHandlers = new Set<(envelope: Envelope) => void>();
  let aClosed = false;
  let bClosed = false;

  const a: Transport = {
    send(envelope) {
      if (aClosed) return;
      queueMicrotask(() => {
        if (bClosed) return;
        for (const handler of bHandlers) handler(envelope);
      });
    },
    onMessage(handler) {
      aHandlers.add(handler);
      return () => {
        aHandlers.delete(handler);
      };
    },
    close() {
      aClosed = true;
      aHandlers.clear();
    },
  };

  const b: Transport = {
    send(envelope) {
      if (bClosed) return;
      queueMicrotask(() => {
        if (aClosed) return;
        for (const handler of aHandlers) handler(envelope);
      });
    },
    onMessage(handler) {
      bHandlers.add(handler);
      return () => {
        bHandlers.delete(handler);
      };
    },
    close() {
      bClosed = true;
      bHandlers.clear();
    },
  };

  return { a, b };
}
