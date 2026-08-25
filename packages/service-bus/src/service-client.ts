import type { z } from 'zod';

import type { ServiceDeclaration, ServiceInterface } from './declaration.js';
import { deserialiseError, HostUnavailableError, ServiceBusError } from './errors.js';
import type { Envelope, MessageId, ServiceId } from './envelope.js';
import type { Transport } from './transport.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('service-bus:client');

/**
 * A handler registered for a pending call, awaiting a return or error message.
 */
interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Options for a `ServiceClient`.
 */
export interface ServiceClientOptions {
  /** Time in milliseconds after which a pending call is rejected as a host failure. */
  callTimeoutMs?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/**
 * The caller-side component of the service bus. Available both on the main
 * thread and to any service running on a host, enabling services to invoke
 * other services.
 *
 * The `ServiceClient` creates typed, validating proxies on demand from service
 * declarations, issues calls to the broker, correlates return and error
 * messages by message ID, and resolves or rejects the caller's promise.
 *
 * @see specs/service-bus.spec.md#serviceclient
 */
export class ServiceClient {
  private readonly transport: Transport;
  private readonly callTimeoutMs: number;
  private readonly pending = new Map<MessageId, PendingCall>();
  private messageCounter = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(transport: Transport, options: ServiceClientOptions = {}) {
    this.transport = transport;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.unsubscribe = transport.onMessage((envelope) => {
      this.handleEnvelope(envelope);
    });
  }

  /**
   * Create a typed, validating proxy for a service from its declaration. The
   * proxy presents the service's functions as typed methods, with parameter
   * and return types derived from the Zod 4 schemas.
   *
   * @see specs/service-bus.spec.md#typed-proxies
   */
  createProxy<T extends ServiceDeclaration>(declaration: T): ServiceInterface<T> {
    const proxy: Record<string, unknown> = {};
    for (const functionName of Object.keys(declaration.functions)) {
      const fnDecl = declaration.functions[functionName];
      if (fnDecl === undefined) continue;
      proxy[functionName] = (params: unknown) => {
        return this.call(declaration.id, functionName, params, fnDecl);
      };
    }
    return proxy as ServiceInterface<T>;
  }

  /**
   * Issue a call to a service function through the broker, returning a promise
   * that is resolved or rejected based on the return or error message.
   *
   * @see specs/service-bus.spec.md#promise-resolution
   */
  call<TParams extends z.ZodType, TReturn extends z.ZodType>(
    serviceId: ServiceId,
    functionName: string,
    params: unknown,
    declaration: { params: TParams; returns: TReturn },
  ): Promise<z.infer<TReturn>> {
    // The proxy may validate parameters against the schema before dispatching,
    // providing early validation at the call site.
    const paramResult = declaration.params.safeParse(params);
    if (!paramResult.success) {
      return Promise.reject(
        new ServiceBusError(
          `Parameter validation failed for ${serviceId}.${functionName}`,
          'VALIDATION_ERROR',
        ),
      );
    }

    return new Promise<z.infer<TReturn>>((resolve, reject) => {
      const messageId = this.generateMessageId();
      const envelope: Envelope = {
        head: {
          messageId,
          service: serviceId,
          function: functionName,
          type: 'call',
          transferables: [],
        },
        body: paramResult.data,
      };

      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        log.warn('call timed out', { service: serviceId, function: functionName, messageId });
        reject(
          new HostUnavailableError(
            `Call to ${serviceId}.${functionName} timed out after ${this.callTimeoutMs}ms`,
          ),
        );
      }, this.callTimeoutMs);

      this.pending.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.transport.send(envelope);
    }).then((returnValue) => {
      // A proxy may validate return values against the schema before resolving
      // the promise to the caller, providing end-to-end type safety.
      const returnResult = declaration.returns.safeParse(returnValue);
      if (!returnResult.success) {
        throw new ServiceBusError(
          `Return value validation failed for ${serviceId}.${functionName}`,
          'RETURN_VALIDATION_ERROR',
        );
      }
      return returnResult.data;
    });
  }

  /**
   * Handle an incoming envelope from the broker (a `return` or `error`
   * message correlated by message ID).
   */
  private handleEnvelope(envelope: Envelope): void {
    if (envelope.head.type !== 'return' && envelope.head.type !== 'error') {
      return;
    }
    const pending = this.pending.get(envelope.head.messageId);
    if (!pending) return;
    this.pending.delete(envelope.head.messageId);
    if (pending.timer) clearTimeout(pending.timer);

    if (envelope.head.type === 'return') {
      log.debug('call returned', {
        service: envelope.head.service,
        function: envelope.head.function,
        messageId: envelope.head.messageId,
      });
      pending.resolve(envelope.body);
    } else {
      log.debug('call rejected', {
        service: envelope.head.service,
        function: envelope.head.function,
        messageId: envelope.head.messageId,
      });
      pending.reject(deserialiseError(envelope.body));
    }
  }

  private generateMessageId(): MessageId {
    return `msg-${++this.messageCounter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Stop receiving messages and reject all pending calls. */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new HostUnavailableError('ServiceClient disposed'));
    }
    this.pending.clear();
  }
}
