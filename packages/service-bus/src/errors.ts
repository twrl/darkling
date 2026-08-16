/**
 * Base error type for all service bus errors. Error messages returned in
 * `error` message bodies are instances of this class or its subclasses.
 *
 * @see specs/service-bus.spec.md#promise-resolution
 */
export class ServiceBusError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  /** Serialise to a plain object for transport across workers. */
  toJSON(): ServiceBusErrorSerialised {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
    };
  }

  /** Deserialise from a plain object received across workers. */
  static fromJSON(data: ServiceBusErrorSerialised): ServiceBusError {
    // Reconstruct a ServiceBusError with the serialised name, code, and message.
    // We do not call subclass constructors because their signatures differ
    // (e.g. ServiceNotRegisteredError takes a serviceId, not a message + code).
    // The name and code carry the type information across the boundary.
    const err = new ServiceBusError(data.message, data.code);
    err.name = data.name;
    return err;
  }
}

/** Serialised form of a ServiceBusError, for transport across worker boundaries. */
export interface ServiceBusErrorSerialised {
  name: string;
  code: string;
  message: string;
}

/**
 * Error thrown when a parameter fails validation against the function's
 * parameter schema.
 *
 * @see specs/service-bus.spec.md#validation
 */
export class ValidationError extends ServiceBusError {
  constructor(
    message: string,
    public readonly issues: unknown[],
  ) {
    super(message, 'VALIDATION_ERROR');
  }

  override toJSON(): ServiceBusErrorSerialised {
    return {
      ...super.toJSON(),
      issues: this.issues,
    } as ServiceBusErrorSerialised & { issues: unknown[] };
  }
}

/**
 * Error thrown when a return value fails validation against the function's
 * return schema.
 *
 * @see specs/service-bus.spec.md#validation
 */
export class ReturnValidationError extends ServiceBusError {
  constructor(
    message: string,
    public readonly issues: unknown[],
  ) {
    super(message, 'RETURN_VALIDATION_ERROR');
  }
}

/**
 * Error thrown when a host is unavailable or fails to respond.
 *
 * @see specs/service-bus.spec.md#promise-resolution
 */
export class HostUnavailableError extends ServiceBusError {
  constructor(message: string) {
    super(message, 'HOST_UNAVAILABLE');
  }
}

/**
 * Error thrown when a service is not registered with the broker.
 */
export class ServiceNotRegisteredError extends ServiceBusError {
  constructor(serviceId: string) {
    super(`Service "${serviceId}" is not registered with the broker`, 'SERVICE_NOT_REGISTERED');
  }
}

/**
 * Error thrown when a function is not declared on a service.
 */
export class FunctionNotDeclaredError extends ServiceBusError {
  constructor(serviceId: string, functionName: string) {
    super(
      `Function "${functionName}" is not declared on service "${serviceId}"`,
      'FUNCTION_NOT_DECLARED',
    );
  }
}

/** Check whether a value is a serialised service bus error. */
export function isServiceBusErrorSerialised(value: unknown): value is ServiceBusErrorSerialised {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'code' in value &&
    'message' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    typeof (value as { code: unknown }).code === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

/** Deserialise an error body received in an `error` message. */
export function deserialiseError(body: unknown): Error {
  if (isServiceBusErrorSerialised(body)) {
    return ServiceBusError.fromJSON(body);
  }
  if (body instanceof Error) {
    return body;
  }
  return new ServiceBusError(String(body), 'UNKNOWN');
}
