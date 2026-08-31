import type { Envelope } from './envelope.js';

/**
 * A bidirectional message transport endpoint.
 *
 * The runtime communicates between the `RuntimeClient` (caller thread),
 * `ServiceBroker` (dedicated worker), and `ServiceHost` instances (dedicated
 * workers) using `postMessage` with message envelopes. This interface
 * abstracts the underlying message channel so that the runtime can operate
 * over real Web Workers, `MessagePort`s, or an in-process mock for testing.
 *
 * @see specs/runtime.spec.md#worker-topology
 */
export interface Transport {
  /**
   * Send an envelope to the other end of the transport. The `transferables`
   * field in the envelope head is passed verbatim as the `transfer` parameter
   * to the underlying `postMessage` call.
   */
  send(envelope: Envelope): void;

  /**
   * Register a handler to receive envelopes from the other end of the
   * transport. Returns an unsubscribe function.
   */
  onMessage(handler: (envelope: Envelope) => void): () => void;

  /** Terminate the transport, releasing any underlying resources. */
  close(): void;
}

/**
 * A pair of connected transports, like two ends of a pipe.
 * Messages sent on one end are received on the other.
 */
export interface TransportPair {
  a: Transport;
  b: Transport;
}
