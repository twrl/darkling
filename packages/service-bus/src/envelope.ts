/**
 * Service identifier — a unique name for a service.
 *
 * @see specs/service-bus.spec.md#service-registration
 */
export type ServiceId = string;

/**
 * Function name — the function being called on a service.
 */
export type FunctionName = string;

/**
 * Message type — one of `call`, `return`, or `error`.
 *
 * @see specs/service-bus.spec.md#message-envelope
 */
export type MessageType = 'call' | 'return' | 'error';

/**
 * A unique identifier for a message, used to correlate calls with returns.
 */
export type MessageId = string;

/**
 * A reference to a Transferable object within a message body, in the format
 * expected by `postMessage`'s `transfer` parameter.
 *
 * @see specs/service-bus.spec.md#transferable-objects
 */
export type TransferableRef = string;

/**
 * The head of a SOAPjr-style envelope. Carries routing metadata.
 *
 * @see specs/service-bus.spec.md#head
 */
export interface EnvelopeHead {
  /** Unique identifier for the message, used to correlate calls with returns. */
  messageId: MessageId;
  /** The service being invoked. */
  service: ServiceId;
  /** The function being called on the service. */
  function: FunctionName;
  /** The kind of message: `call`, `return`, or `error`. */
  type: MessageType;
  /**
   * References to Transferable objects within the body, in the format expected
   * by `postMessage`'s `transfer` parameter. An empty list when the body
   * contains no Transferable objects.
   */
  transferables: TransferableRef[];
}

/**
 * A SOAPjr-style message envelope. The head carries routing metadata; the body
 * carries the payload.
 *
 * For a `call` message, the body is the parameter object.
 * For a `return` message, the body is the return value.
 * For an `error` message, the body is the error description.
 *
 * @see specs/service-bus.spec.md#message-envelope
 */
export interface Envelope {
  head: EnvelopeHead;
  body: unknown;
}
