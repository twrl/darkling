/**
 * Service identifier — a unique name for a service.
 *
 * @see specs/runtime.spec.md#service-declarations
 */
export type ServiceId = string;

/**
 * Function name — the function or behaviour being called on a service.
 */
export type FunctionName = string;

/**
 * Message type — one of `call`, `behaviour`, `return`, or `error`.
 *
 * `call` messages expect a `return` or `error` response, correlated by message
 * ID. `behaviour` messages are fire-and-forget: no response is expected and no
 * correlation state is allocated.
 *
 * @see specs/runtime.spec.md#message-envelope
 */
export type MessageType = 'call' | 'behaviour' | 'return' | 'error';

/**
 * A unique identifier for a message, used to correlate calls with returns.
 *
 * Behaviour messages do not require correlation, but still carry a message ID
 * for delivery ordering and logging.
 */
export type MessageId = string;

/**
 * A reference to a Transferable object within a message body, in the format
 * expected by `postMessage`'s `transfer` parameter.
 *
 * @see specs/runtime.spec.md#transferable-objects
 */
export type TransferableRef = string;

/**
 * The head of a SOAPjr-style envelope. Carries routing metadata.
 *
 * @see specs/runtime.spec.md#head
 */
export interface EnvelopeHead {
  /** Unique identifier for the message. For `call` messages, used to correlate with the `return` or `error`. */
  messageId: MessageId;
  /** The service being invoked. */
  service: ServiceId;
  /** The function or behaviour being called on the service. */
  function: FunctionName;
  /** The kind of message: `call`, `behaviour`, `return`, or `error`. */
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
 * For a `behaviour` message, the body is the parameter object.
 * For a `return` message, the body is the return value.
 * For an `error` message, the body is the error description.
 *
 * @see specs/runtime.spec.md#message-envelope
 */
export interface Envelope {
  head: EnvelopeHead;
  body: unknown;
}
