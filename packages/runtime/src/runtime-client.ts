import type { ServiceDeclaration, ServiceProxy } from './declaration.js';
import { deserialiseError, HostUnavailableError } from './errors.js';
import type { Envelope, MessageId, ServiceId } from './envelope.js';
import type { Transport } from './transport.js';
import type { ServiceRegistration } from './registration.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('runtime:client');

/**
 * A handler registered for a pending call, awaiting a return or error message.
 */
interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Options for a `RuntimeClient`.
 */
export interface RuntimeClientOptions {
  /** Time in milliseconds after which a pending call is rejected as a host failure. */
  callTimeoutMs?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/**
 * The caller-side component of the runtime. Available both on the main thread
 * and to any service running on a host, enabling services to invoke other
 * services, dispatch behaviours, and commit mutations.
 *
 * The `RuntimeClient` creates typed proxies on demand from service
 * declarations, issues calls and behaviours to the broker, correlates return
 * and error messages by message ID, and resolves or rejects the caller's
 * promise. Behaviours do not produce promises — the runtime does not allocate
 * message-correlation state for them.
 *
 * @see specs/runtime.spec.md#runtimeclient
 */
export class RuntimeClient {
  private readonly transport: Transport;
  private readonly callTimeoutMs: number;
  private readonly pending = new Map<MessageId, PendingCall>();
  private messageCounter = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(transport: Transport, options: RuntimeClientOptions = {}) {
    this.transport = transport;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.unsubscribe = transport.onMessage((envelope) => {
      this.handleEnvelope(envelope);
    });
  }

  /**
   * Create a typed proxy for a service from its declaration. If the declaration
   * includes a `proxyFactory`, the runtime calls it with this `RuntimeClient`
   * and uses the returned object as the proxy. Otherwise, the runtime generates
   * a default proxy from the declared functions and behaviours.
   *
   * @see specs/runtime.spec.md#typed-proxies
   * @see specs/runtime.spec.md#proxy-factories
   */
  proxy<T extends ServiceDeclaration>(
    declaration: T,
  ): T extends { proxyFactory: infer F }
    ? F extends (client: RuntimeClient) => infer R
      ? R
      : ServiceProxy<T>
    : ServiceProxy<T> {
    if (declaration.proxyFactory) {
      return declaration.proxyFactory(this) as T extends { proxyFactory: infer F }
        ? F extends (client: RuntimeClient) => infer R
          ? R
          : ServiceProxy<T>
        : ServiceProxy<T>;
    }
    return this.createDefaultProxy(declaration) as T extends { proxyFactory: infer F }
      ? F extends (client: RuntimeClient) => infer R
        ? R
        : ServiceProxy<T>
      : ServiceProxy<T>;
  }

  /**
   * Generate a default proxy from the declared functions and behaviours.
   * Functions become typed methods returning `Promise<...>`; behaviours become
   * typed methods returning `void`.
   */
  private createDefaultProxy<T extends ServiceDeclaration>(declaration: T): ServiceProxy<T> {
    const proxy: Record<string, unknown> = {};
    for (const functionName of Object.keys(declaration.functions)) {
      proxy[functionName] = (params: unknown) => {
        return this.call(declaration.id, functionName, params);
      };
    }
    // Behaviours on the default proxy: typed methods returning void.
    if (declaration.behaviours) {
      for (const behaviourName of Object.keys(declaration.behaviours)) {
        proxy[behaviourName] = (params: unknown) => {
          this.behaviour(declaration.id, behaviourName, params);
        };
      }
    }
    return proxy as ServiceProxy<T>;
  }

  /**
   * Issue a call to a service function through the broker, returning a promise
   * that is resolved or rejected based on the return or error message.
   *
   * The spec defines the signature as:
   * ```ts
   * call(service: ServiceId, fn: string, params: unknown, opts?: { transfer?: Transferable[] }): Promise<unknown>;
   * ```
   * Parameter and return validation is performed by the host (using the
   * declaration's Zod schemas) and optionally by a proxy factory. The low-level
   * `call` itself does not take a declaration — it dispatches raw.
   *
   * @see specs/runtime.spec.md#proxy-factories
   * @see specs/runtime.spec.md#promise-resolution
   */
  call(
    service: ServiceId,
    fn: string,
    params: unknown,
    opts?: { transfer?: Transferable[] },
  ): Promise<unknown> {
    const messageId = this.generateMessageId();
    const envelope: Envelope = {
      head: {
        messageId,
        service,
        function: fn,
        type: 'call',
        transferables: [],
      },
      body: params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        log.warn('call timed out', { service, function: fn, messageId });
        reject(
          new HostUnavailableError(
            `Call to ${service}.${fn} timed out after ${this.callTimeoutMs}ms`,
          ),
        );
      }, this.callTimeoutMs);

      this.pending.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.transport.send(envelope);
    });
  }

  /**
   * Dispatch a behaviour to a service through the broker. Behaviours are
   * fire-and-forget: the caller does not receive a promise. The runtime
   * guarantees delivery to the target service's processing context.
   *
   * The spec defines the signature as:
   * ```ts
   * behaviour(service: ServiceId, fn: string, params: unknown, opts?: { transfer?: Transferable[] }): void;
   * ```
   * Parameter validation is performed by the host. The low-level `behaviour`
   * itself dispatches raw.
   *
   * @see specs/runtime.spec.md#behaviours
   */
  behaviour(
    service: ServiceId,
    fn: string,
    params: unknown,
    opts?: { transfer?: Transferable[] },
  ): void {
    const messageId = this.generateMessageId();
    const envelope: Envelope = {
      head: {
        messageId,
        service,
        function: fn,
        type: 'behaviour',
        transferables: [],
      },
      body: params,
    };

    this.transport.send(envelope);
  }

  /**
   * Register a service with the broker. The registration record is serializable
   * (ID + module specifier + metadata). Once `registerService` resolves, the
   * service is immediately callable.
   *
   * @see specs/runtime.spec.md#service-registration
   */
  async registerService(registration: ServiceRegistration): Promise<void> {
    const messageId = this.generateMessageId();
    // Service registration is sent as a control message to the broker.
    // We use a special envelope type: the broker recognises registrations
    // by the `service` field being empty and the function being `__register`.
    // This is an implementation detail; the broker handles it before routing.
    const envelope: Envelope = {
      head: {
        messageId,
        service: '__runtime',
        function: '__registerService',
        type: 'call',
        transferables: [],
      },
      body: registration,
    };

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new HostUnavailableError('Service registration timed out'));
      }, this.callTimeoutMs);

      this.pending.set(messageId, {
        resolve: () => resolve(),
        reject,
        timer,
      });

      this.transport.send(envelope);
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
      pending.reject(new HostUnavailableError('RuntimeClient disposed'));
    }
    this.pending.clear();
  }
}
