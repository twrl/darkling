/**
 * Base error type for all runtime errors. Error messages returned in `error`
 * message bodies are instances of this class or its subclasses.
 *
 * @see specs/runtime.spec.md#promise-resolution
 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  /** Serialise to a plain object for transport across workers. */
  toJSON(): RuntimeErrorSerialised {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
    };
  }

  /** Deserialise from a plain object received across workers. */
  static fromJSON(data: RuntimeErrorSerialised): RuntimeError {
    // Reconstruct a RuntimeError with the serialised name, code, and message.
    // We do not call subclass constructors because their signatures differ.
    // The name and code carry the type information across the boundary.
    const err = new RuntimeError(data.message, data.code);
    err.name = data.name;
    return err;
  }
}

/** Serialised form of a RuntimeError, for transport across worker boundaries. */
export interface RuntimeErrorSerialised {
  name: string;
  code: string;
  message: string;
}

/**
 * Error thrown when a parameter fails validation against the function or
 * behaviour's parameter schema.
 *
 * @see specs/runtime.spec.md#validation
 */
export class ValidationError extends RuntimeError {
  constructor(
    message: string,
    public readonly issues: unknown[],
  ) {
    super(message, 'VALIDATION_ERROR');
  }

  override toJSON(): RuntimeErrorSerialised {
    return {
      ...super.toJSON(),
      issues: this.issues,
    } as RuntimeErrorSerialised & { issues: unknown[] };
  }
}

/**
 * Error thrown when a return value fails validation against the function's
 * return schema.
 *
 * @see specs/runtime.spec.md#validation
 */
export class ReturnValidationError extends RuntimeError {
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
 * @see specs/runtime.spec.md#promise-resolution
 */
export class HostUnavailableError extends RuntimeError {
  constructor(message: string) {
    super(message, 'HOST_UNAVAILABLE');
  }
}

/**
 * Error thrown when a service is not registered with the broker.
 */
export class ServiceNotRegisteredError extends RuntimeError {
  constructor(serviceId: string) {
    super(`Service "${serviceId}" is not registered with the broker`, 'SERVICE_NOT_REGISTERED');
  }
}

/**
 * Error thrown when a function or behaviour is not declared on a service.
 */
export class FunctionNotDeclaredError extends RuntimeError {
  constructor(serviceId: string, functionName: string) {
    super(
      `Function "${functionName}" is not declared on service "${serviceId}"`,
      'FUNCTION_NOT_DECLARED',
    );
  }
}

// --- State authority errors ---

/**
 * The mutation's `basisSeq` does not match the slice's current authoritative
 * sequence number. The store helper retries transparently after local copy
 * convergence.
 *
 * @see specs/runtime.spec.md#optimistic-concurrency
 */
export class StaleBasisError extends RuntimeError {
  constructor(
    message: string,
    public readonly slice: string,
    public readonly currentSeq: number,
    public readonly basisSeq: number,
  ) {
    super(message, 'STALE_BASIS');
  }
}

/**
 * A patch could not be applied to the authoritative slice value. This indicates
 * the patch was generated against an incompatible shape, or the patch is
 * malformed.
 *
 * @see specs/runtime.spec.md#mutation-processing
 */
export class PatchNotApplicableError extends RuntimeError {
  constructor(
    message: string,
    public readonly slice: string,
  ) {
    super(message, 'PATCH_NOT_APPLICABLE');
  }
}

/**
 * Error thrown when a mutation targets a slice that is not registered or not
 * yet loaded.
 *
 * @see specs/runtime.spec.md#slice-registration
 */
export class SliceNotRegisteredError extends RuntimeError {
  constructor(sliceId: string) {
    super(`Slice "${sliceId}" is not registered or not yet loaded`, 'SLICE_NOT_REGISTERED');
  }
}

/** Check whether a value is a serialised runtime error. */
export function isRuntimeErrorSerialised(value: unknown): value is RuntimeErrorSerialised {
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
  if (isRuntimeErrorSerialised(body)) {
    return RuntimeError.fromJSON(body);
  }
  if (body instanceof Error) {
    return body;
  }
  return new RuntimeError(String(body), 'UNKNOWN');
}
