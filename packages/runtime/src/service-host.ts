import type { z } from 'zod';

import type { ServiceDeclaration } from './declaration.js';
import { ReturnValidationError, RuntimeError } from './errors.js';
import type { Envelope } from './envelope.js';
import type { Transport } from './transport.js';
import type { ServiceCallContext } from './service-call-context.js';
import type { HostContext, ServiceImplementation } from './service-implementation.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('runtime:host');

/**
 * The activation state of a service on a host.
 *
 * @see specs/runtime.spec.md#activation-states
 */
type ActivationState = 'inactive' | 'activating_1' | 'activating_2' | 'active';

/**
 * A service's runtime state on a host: its declaration, implementation,
 * activation state, and message queue.
 */
interface ServiceEntry {
  declaration: ServiceDeclaration;
  implementation: ServiceImplementation;
  state: ActivationState;
  /** Messages queued while the service is in activating_1 or activating_2. */
  queue: Envelope[];
  /** The initializer behaviour name, if declared. */
  initializer: string | undefined;
  /** The required slices, if declared. */
  requiredSlices: string[] | undefined;
  /**
   * The per-service processing promise chain. Messages are processed strictly
   * in delivery order by chaining each message onto the previous one's
   * completion.
   */
  processingChain: Promise<void>;
}

/**
 * The host interface presented to the broker: `activate`, `deactivate`,
 * `dispatch`. The broker routes to a host uniformly regardless of whether it
 * is local or remote.
 *
 * @see specs/runtime.spec.md#servicehost
 */
export interface HostInterface {
  activate(
    declaration: ServiceDeclaration,
    implementationClass: new (hostContext: HostContext) => ServiceImplementation,
  ): void;
  deactivate(serviceId: string): void;
  dispatch(envelope: Envelope): void;
  hasService(serviceId: string): boolean;
  readonly serviceIds: string[];
  start(): void;
  stop(): void;
  /** Notify the host that required slices for a service have been loaded. */
  notifySlicesLoaded(serviceId: string): void;
}

/**
 * A `ServiceHost` receives messages from the broker, dispatches them to the
 * appropriate service function or behaviour, and returns the result (for
 * functions) or nothing (for behaviours).
 *
 * Each host may support multiple services. A host is launched by the broker on
 * demand.
 *
 * The host manages the activation state of each service it supports, including
 * the initializer protocol and per-service serial message processing.
 *
 * @see specs/runtime.spec.md#servicehost
 * @see specs/runtime.spec.md#initialization
 * @see specs/runtime.spec.md#message-ordering
 */
export class ServiceHost implements HostInterface {
  private readonly transport: Transport;
  private readonly hostContext: HostContext;
  private readonly services = new Map<string, ServiceEntry>();
  private unsubscribe: (() => void) | null = null;

  /**
   * @param transport Transport endpoint connected to the broker.
   * @param hostContext Context provided to each service implementation's
   *   constructor, giving it access to the runtime.
   */
  constructor(transport: Transport, hostContext: HostContext) {
    this.transport = transport;
    this.hostContext = hostContext;
  }

  /**
   * Activate a service on this host by registering its declaration and
   * instantiating its implementation class. The host constructs the
   * implementation with the {@link HostContext}, giving it access to the
   * runtime.
   *
   * The service enters the activation lifecycle based on its metadata:
   * - If `requiredSlices` is declared, the service enters `activating_1`.
   * - If `initializer` is declared (but no `requiredSlices`), the service
   *   enters `activating_2`.
   * - If neither is declared, the service transitions directly to `active`.
   *
   * @see specs/runtime.spec.md#initialization
   */
  activate(
    declaration: ServiceDeclaration,
    implementationClass: new (hostContext: HostContext) => ServiceImplementation,
  ): void {
    const implementation = new implementationClass(this.hostContext);
    const requiredSlices = declaration.metadata?.requiredSlices;
    const initializer = declaration.metadata?.initializer;

    let state: ActivationState = 'active';
    if (requiredSlices && requiredSlices.length > 0) {
      state = 'activating_1';
    } else if (initializer) {
      state = 'activating_2';
    }

    this.services.set(declaration.id, {
      declaration,
      implementation,
      state,
      queue: [],
      initializer,
      requiredSlices: requiredSlices && requiredSlices.length > 0 ? requiredSlices : undefined,
      processingChain: Promise.resolve(),
    });

    log.info('service activated', {
      serviceId: declaration.id,
      state,
      hasInitializer: !!initializer,
      requiredSlices: requiredSlices ?? [],
    });
  }

  /** Start listening for messages from the broker. */
  start(): void {
    if (this.unsubscribe) return;
    log.debug('host starting', { services: [...this.services.keys()] });
    this.unsubscribe = this.transport.onMessage((envelope) => {
      this.dispatch(envelope);
    });
  }

  /** Stop listening for messages. */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Dispatch an incoming envelope to the appropriate service. Messages are
   * queued if the service is in `activating_1` or `activating_2` state.
   * Messages are processed strictly in delivery order, one at a time per
   * service.
   *
   * @see specs/runtime.spec.md#message-ordering
   * @see specs/runtime.spec.md#initialization
   */
  dispatch(envelope: Envelope): void {
    if (envelope.head.type !== 'call' && envelope.head.type !== 'behaviour') return;

    const { service, function: functionName } = envelope.head;
    const entry = this.services.get(service);
    if (!entry) {
      if (envelope.head.type === 'call') {
        this.sendError(envelope, {
          name: 'ServiceNotRegisteredError',
          code: 'SERVICE_NOT_REGISTERED',
          message: `Service "${service}" is not activated on this host`,
        });
      }
      return;
    }

    // Check if this is the initializer behaviour in activating_2 state.
    if (
      entry.initializer &&
      functionName === entry.initializer &&
      envelope.head.type === 'behaviour' &&
      entry.state === 'activating_2'
    ) {
      // Initializer bypasses the queue in activating_2: deliver directly,
      // ahead of any queued messages.
      this.chainMessage(entry, envelope);
      return;
    }

    // Queue messages while in activating_1 or activating_2.
    if (entry.state === 'activating_1' || entry.state === 'activating_2') {
      entry.queue.push(envelope);
      return;
    }

    // Active: process the message (with per-service serialisation).
    this.chainMessage(entry, envelope);
  }

  /**
   * Chain a message onto the service's processing promise, ensuring per-service
   * serial processing. The next message to a service is not started until the
   * current one has completed.
   *
   * @see specs/runtime.spec.md#processing-ordering
   */
  private chainMessage(entry: ServiceEntry, envelope: Envelope): void {
    entry.processingChain = entry.processingChain
      .then(() => this.handleMessage(entry, envelope))
      .catch((error) => {
        // Errors from handleMessage are sent as error messages to the caller.
        // Swallow them here so the chain doesn't break for subsequent messages.
        log.debug('message processing error swallowed', {
          service: envelope.head.service,
          function: envelope.head.function,
          messageId: envelope.head.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /**
   * Handle a single message: validate parameters, dispatch to the
   * implementation, validate the return (for functions), and send a return or
   * error message back (for functions). Behaviours produce no response.
   */
  private async handleMessage(entry: ServiceEntry, envelope: Envelope): Promise<void> {
    const { service, function: functionName, messageId, type } = envelope.head;
    const declaration = entry.declaration;
    const isBehaviour = type === 'behaviour';

    // Look up the declaration for this function or behaviour.
    const fnDecl = declaration.functions[functionName];
    const bDecl = declaration.behaviours?.[functionName];

    // Determine which schema to use for parameter validation.
    let paramsSchema: z.ZodType | undefined;
    let returnsSchema: z.ZodType | undefined;

    if (fnDecl && !isBehaviour) {
      paramsSchema = fnDecl.params;
      returnsSchema = fnDecl.returns;
    } else if (bDecl && isBehaviour) {
      paramsSchema = bDecl.params;
    } else {
      // Mismatched type (function called as behaviour or vice versa) or
      // undeclared name.
      if (!isBehaviour) {
        this.sendError(envelope, {
          name: 'FunctionNotDeclaredError',
          code: 'FUNCTION_NOT_DECLARED',
          message: `Function "${functionName}" is not declared on service "${service}"`,
        });
      } else {
        log.warn('behaviour not declared', { service, function: functionName });
      }
      return;
    }

    // Validate the parameter against the schema.
    const paramResult = paramsSchema.safeParse(envelope.body);
    if (!paramResult.success) {
      log.warn('parameter validation failed', { service, function: functionName, messageId });
      if (!isBehaviour) {
        this.sendError(envelope, {
          name: 'ValidationError',
          code: 'VALIDATION_ERROR',
          message: `Parameter validation failed for ${service}.${functionName}`,
          issues: paramResult.error.issues,
        });
      }
      return;
    }

    const impl = entry.implementation as unknown as Record<
      string,
      (params: unknown, context: ServiceCallContext) => unknown
    >;
    const context: ServiceCallContext = { serviceId: service, functionName, messageId };

    try {
      const method = impl[functionName];
      if (typeof method !== 'function') {
        throw new RuntimeError(
          `Method "${functionName}" is not defined on service "${service}"`,
          'FUNCTION_NOT_DECLARED',
        );
      }

      const returnValue = await method.call(entry.implementation, paramResult.data, context);

      if (!isBehaviour) {
        // Validate the return value against the function's return schema.
        const returnResult = returnsSchema!.safeParse(returnValue);
        if (!returnResult.success) {
          throw new ReturnValidationError(
            `Return value validation failed for ${service}.${functionName}`,
            returnResult.error.issues,
          );
        }
        log.debug('call succeeded', { service, function: functionName, messageId });
        this.sendReturn(envelope, returnResult.data);
      } else {
        log.debug('behaviour completed', { service, function: functionName, messageId });
      }

      // If this was the initializer and the service is in activating_2,
      // transition to active and drain the queue.
      if (
        isBehaviour &&
        entry.initializer &&
        functionName === entry.initializer &&
        entry.state === 'activating_2'
      ) {
        this.transitionToActive(entry);
      }
    } catch (error) {
      if (!isBehaviour) {
        log.warn('call failed', {
          service,
          function: functionName,
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.sendError(
          envelope,
          error instanceof RuntimeError
            ? (error.toJSON() as unknown as Record<string, unknown>)
            : {
                name: error instanceof Error ? error.constructor.name : 'Error',
                code: 'SERVICE_ERROR',
                message: error instanceof Error ? error.message : String(error),
              },
        );
      } else {
        log.warn('behaviour failed', {
          service,
          function: functionName,
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Transition a service from `activating_1` to `activating_2` when all
   * required slices are loaded.
   *
   * If the initializer is already in the queue, it is extracted and delivered
   * first (bypassing the queue order for other messages). If the initializer
   * has not yet arrived, the host waits for it.
   *
   * @see specs/runtime.spec.md#activation-protocol
   */
  notifySlicesLoaded(serviceId: string): void {
    const entry = this.services.get(serviceId);
    if (!entry || entry.state !== 'activating_1') return;

    entry.state = 'activating_2';
    log.info('service transitioned to activating_2', { serviceId });

    // If the initializer is already queued, extract and deliver it.
    if (entry.initializer) {
      const initializerIdx = entry.queue.findIndex(
        (env) => env.head.function === entry.initializer && env.head.type === 'behaviour',
      );
      if (initializerIdx >= 0) {
        const [initEnv] = entry.queue.splice(initializerIdx, 1);
        if (!initEnv) return;
        // Deliver the initializer, bypassing the queue. It chains onto the
        // processing promise; when it completes, the transition to active
        // will drain the remaining queue.
        this.chainMessage(entry, initEnv);
        return;
      }
      // Initializer not yet arrived; wait for it in activating_2.
    } else {
      // No initializer; transition directly to active.
      this.transitionToActive(entry);
    }
  }

  /**
   * Transition a service to active and dispatch all queued messages in
   * delivery order.
   */
  private transitionToActive(entry: ServiceEntry): void {
    entry.state = 'active';
    const serviceId = entry.declaration.id;
    log.info('service transitioned to active', { serviceId, queued: entry.queue.length });

    // Chain all queued messages in delivery order. The promise chain ensures
    // they are processed one at a time, in order.
    while (entry.queue.length > 0) {
      const env = entry.queue.shift()!;
      this.chainMessage(entry, env);
    }
  }

  private sendReturn(callEnvelope: Envelope, returnValue: unknown): void {
    const envelope: Envelope = {
      head: {
        messageId: callEnvelope.head.messageId,
        service: callEnvelope.head.service,
        function: callEnvelope.head.function,
        type: 'return',
        transferables: callEnvelope.head.transferables,
      },
      body: returnValue,
    };
    this.transport.send(envelope);
  }

  private sendError(callEnvelope: Envelope, errorBody: unknown): void {
    const envelope: Envelope = {
      head: {
        messageId: callEnvelope.head.messageId,
        service: callEnvelope.head.service,
        function: callEnvelope.head.function,
        type: 'error',
        transferables: [],
      },
      body: errorBody,
    };
    this.transport.send(envelope);
  }

  /** Deactivate a service, clearing its state. */
  deactivate(serviceId: string): void {
    this.services.delete(serviceId);
    log.info('service deactivated', { serviceId });
  }

  /** Whether this host has a particular service activated. */
  hasService(serviceId: string): boolean {
    return this.services.has(serviceId);
  }

  /** The service IDs activated on this host. */
  get serviceIds(): string[] {
    return [...this.services.keys()];
  }
}
