import type { ServiceDeclaration } from './declaration.js';
import { ReturnValidationError, ServiceBusError, ValidationError } from './errors.js';
import type { Envelope } from './envelope.js';
import type { Transport } from './transport.js';
import type { ServiceCallContext } from './service-call-context.js';
import type { HostContext, ServiceImplementation } from './service-implementation.js';

/**
 * A `ServiceHost` receives messages from the broker, dispatches them to the
 * appropriate service function, and returns the result.
 *
 * Each host may support multiple services. A host is launched and activated by
 * the broker on demand.
 *
 * @see specs/service-bus.spec.md#servicehost
 */
export class ServiceHost {
  private readonly transport: Transport;
  private readonly hostContext: HostContext;
  private readonly declarations = new Map<string, ServiceDeclaration>();
  private readonly implementations = new Map<string, ServiceImplementation>();
  private unsubscribe: (() => void) | null = null;

  /**
   * @param transport Transport endpoint connected to the broker.
   * @param hostContext Context provided to each service implementation's
   *   constructor, giving it access to the bus (e.g. a service client for
   *   service-to-service calls).
   */
  constructor(transport: Transport, hostContext: HostContext) {
    this.transport = transport;
    this.hostContext = hostContext;
  }

  /**
   * Activate a service on this host by registering its declaration and
   * instantiating its implementation class. The host constructs the
   * implementation with the {@link HostContext}, giving it access to the bus.
   * The host may support multiple services.
   *
   * @see specs/service-bus.spec.md#on-demand-activation
   */
  activate(
    declaration: ServiceDeclaration,
    implementationClass: new (hostContext: HostContext) => ServiceImplementation,
  ): void {
    const implementation = new implementationClass(this.hostContext);
    this.declarations.set(declaration.id, declaration);
    this.implementations.set(declaration.id, implementation);
  }

  /** Start listening for messages from the broker. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.onMessage((envelope) => {
      void this.handleCall(envelope);
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
   * Handle a `call` message from the broker: validate the parameter, dispatch
   * to the service function, validate the return, and send a `return` or
   * `error` message back.
   *
   * @see specs/service-bus.spec.md#service-interface-contract
   */
  private async handleCall(envelope: Envelope): Promise<void> {
    if (envelope.head.type !== 'call') return;

    const { service, function: functionName, messageId, transferables } = envelope.head;

    const declaration = this.declarations.get(service);
    if (!declaration) {
      this.sendError(messageId, service, functionName, {
        name: 'ServiceNotRegisteredError',
        code: 'SERVICE_NOT_REGISTERED',
        message: `Service "${service}" is not activated on this host`,
      });
      return;
    }

    const fnDecl = declaration.functions[functionName];
    if (!fnDecl) {
      this.sendError(messageId, service, functionName, {
        name: 'FunctionNotDeclaredError',
        code: 'FUNCTION_NOT_DECLARED',
        message: `Function "${functionName}" is not declared on service "${service}"`,
      });
      return;
    }

    // The host must validate the parameter against the function's parameter
    // schema before dispatching the call.
    const paramResult = fnDecl.params.safeParse(envelope.body);
    if (!paramResult.success) {
      this.sendError(messageId, service, functionName, {
        name: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: `Parameter validation failed for ${service}.${functionName}`,
        issues: paramResult.error.issues,
      });
      return;
    }

    const impl = this.implementations.get(service);
    if (!impl) {
      this.sendError(messageId, service, functionName, {
        name: 'ServiceNotRegisteredError',
        code: 'SERVICE_NOT_REGISTERED',
        message: `No implementation for service "${service}"`,
      });
      return;
    }

    const context: ServiceCallContext = { serviceId: service, functionName, messageId };

    try {
      const returnValue = await impl.invoke(functionName, paramResult.data, context);

      // The host must validate the return value against the function's return
      // schema before returning it.
      const returnResult = fnDecl.returns.safeParse(returnValue);
      if (!returnResult.success) {
        throw new ReturnValidationError(
          `Return value validation failed for ${service}.${functionName}`,
          returnResult.error.issues,
        );
      }

      this.sendReturn(messageId, service, functionName, returnResult.data, transferables);
    } catch (error) {
      this.sendError(
        messageId,
        service,
        functionName,
        error instanceof ServiceBusError
          ? (error.toJSON() as unknown as Record<string, unknown>)
          : {
              name: error instanceof Error ? error.constructor.name : 'Error',
              code: 'SERVICE_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
      );
    }
  }

  private sendReturn(
    messageId: string,
    service: string,
    functionName: string,
    returnValue: unknown,
    transferables: string[],
  ): void {
    const envelope: Envelope = {
      head: {
        messageId,
        service,
        function: functionName,
        type: 'return',
        transferables,
      },
      body: returnValue,
    };
    this.transport.send(envelope);
  }

  private sendError(
    messageId: string,
    service: string,
    functionName: string,
    errorBody: unknown,
  ): void {
    const envelope: Envelope = {
      head: {
        messageId,
        service,
        function: functionName,
        type: 'error',
        transferables: [],
      },
      body: errorBody,
    };
    this.transport.send(envelope);
  }

  /** Whether this host has a particular service activated. */
  hasService(serviceId: string): boolean {
    return this.declarations.has(serviceId);
  }

  /** The service IDs activated on this host. */
  get serviceIds(): string[] {
    return [...this.declarations.keys()];
  }
}
