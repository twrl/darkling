import type { ServiceDeclaration } from './declaration.js';
import { HostUnavailableError } from './errors.js';
import type { Envelope, MessageId, ServiceId } from './envelope.js';
import type { Transport } from './transport.js';
import { createInProcessTransportPair } from './in-process-transport.js';
import type { HostInterface } from './service-host.js';
import { ServiceHost } from './service-host.js';
import type { HostContext } from './service-implementation.js';
import { RuntimeClient } from './runtime-client.js';
import type { ServiceRegistration, SliceRegistration, RegistryValue } from './registration.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('runtime:broker');

/**
 * A resolver that maps service IDs to their live declaration. Used by the
 * {@link InProcessHostSpawner} to obtain the declaration.
 */
export type ServiceModuleResolver = (
  serviceId: string,
  moduleSpecifier: string,
) => ServiceDeclaration | undefined;

/**
 * A host tracked by the broker: its transport, the service IDs it has
 * activated, and an optional handle to the host interface (for the local host).
 */
interface BrokerHost {
  transport: Transport;
  serviceIds: Set<string>;
  unsubscribe: () => void;
  /** The host interface, if this is the broker's local host. */
  hostInterface: HostInterface | null;
}

/**
 * A factory that launches a `ServiceHost` for the given services.
 *
 * The broker uses a `HostSpawner` to launch remote hosts on demand. The local
 * host is created directly by the broker, not via the spawner.
 */
export interface HostSpawner {
  launch(services: ServiceRegistration[]): Promise<{ transport: Transport; serviceIds: string[] }>;
}

/**
 * Callback type for registry updates. The broker notifies the authority (which
 * holds the registry pseudo-slice) when registrations change.
 */
export type RegistryUpdateCallback = (update: (registry: RegistryValue) => RegistryValue) => void;

/**
 * The `ServiceBroker` is the central routing and coordination point for the
 * runtime. It runs in a Web Worker.
 *
 * The broker routes messages between all transports — the client transport
 * (main thread) and each host transport — using a single unified routing
 * function. Every transport's incoming messages go through the same logic:
 *
 * - `call` and `behaviour` messages are routed to the host assigned to the
 *   target service (launching or activating a host if necessary).
 * - `return` and `error` messages are routed back to the transport that issued
 *   the corresponding `call`, correlated by message ID.
 *
 * The broker tracks the source transport of each pending call so that returns
 * can be delivered to the correct caller, whether that caller is on the main
 * thread or a service on another host.
 *
 * @see specs/runtime.spec.md#servicebroker
 */
export class ServiceBroker {
  private readonly clientTransport: Transport;
  private readonly spawner: HostSpawner | null;
  private readonly registrations = new Map<ServiceId, ServiceRegistration>();
  private readonly hosts = new Map<string, BrokerHost>();
  private readonly serviceToHost = new Map<ServiceId, string>();
  /**
   * Maps message IDs of pending calls to the transport that the call
   * originated from. Used to route return/error messages back to the correct
   * caller — which may be the main thread or a service on another host.
   */
  private readonly callOrigins = new Map<MessageId, Transport>();
  private hostCounter = 0;
  private unsubscribe: (() => void) | null = null;
  private localHost: ServiceHost | null = null;
  private localHostTransport: Transport | null = null;
  private readonly localHostContext: HostContext;
  private readonly resolver: ServiceModuleResolver | null;
  private registryCallback: RegistryUpdateCallback | null = null;

  /**
   * @param clientTransport Transport endpoint connected to the `RuntimeClient`
   *   on the main thread.
   * @param localHostContext The `HostContext` for the broker's local host.
   * @param options Optional spawner for remote hosts and resolver for
   *   in-process declaration loading.
   */
  constructor(
    clientTransport: Transport,
    localHostContext: HostContext,
    options?: {
      spawner?: HostSpawner;
      resolver?: ServiceModuleResolver;
    },
  ) {
    this.clientTransport = clientTransport;
    this.localHostContext = localHostContext;
    this.spawner = options?.spawner ?? null;
    this.resolver = options?.resolver ?? null;
  }

  /**
   * Set the callback invoked when the registry pseudo-slice should be updated.
   */
  setRegistryCallback(callback: RegistryUpdateCallback): void {
    this.registryCallback = callback;
  }

  /**
   * Get the current registry callback, for wiring into the local host context.
   */
  getRegistryCallback(): RegistryUpdateCallback | null {
    return this.registryCallback;
  }

  /**
   * Register a service with the broker.
   *
   * @see specs/runtime.spec.md#service-registration
   */
  register(registration: ServiceRegistration): void {
    this.registrations.set(registration.id, registration);
    this.updateRegistry((reg) => ({
      ...reg,
      services: { ...reg.services, [registration.id]: registration },
    }));
    log.info('service registered', { serviceId: registration.id });
  }

  /**
   * Register a slice with the broker.
   *
   * @see specs/runtime.spec.md#slice-registration
   */
  registerSlice(registration: SliceRegistration): void {
    this.updateRegistry((reg) => ({
      ...reg,
      slices: { ...reg.slices, [registration.id]: registration },
    }));
    log.info('slice registered', { sliceId: registration.id });
  }

  private updateRegistry(update: (registry: RegistryValue) => RegistryValue): void {
    if (this.registryCallback) {
      this.registryCallback(update);
    }
  }

  /**
   * Start the broker. Sets up message handlers on the client transport and
   * creates the local host.
   *
   * The client transport and every host transport are handled through the same
   * {@link routeIncoming} method, ensuring uniform routing for calls,
   * behaviours, returns, and errors regardless of their source.
   */
  start(): void {
    if (this.unsubscribe) return;
    log.info('broker starting');

    // Create the local host.
    const { a: brokerSide, b: hostSide } = createInProcessTransportPair();
    this.localHostTransport = brokerSide;
    // Create a RuntimeClient for the local host, wired to the host's transport.
    // This enables colocated services to call other services through the broker.
    const localClient = new RuntimeClient(hostSide);
    const localHostContext: HostContext = {
      ...this.localHostContext,
      client: localClient,
      registryCallback: this.registryCallback ?? undefined,
    };
    this.localHost = new ServiceHost(hostSide, localHostContext);
    this.localHost.start();

    // Track the local host. Its transport is handled through routeIncoming,
    // just like remote hosts and the client transport.
    const localHostId = 'local';
    this.hosts.set(localHostId, {
      transport: brokerSide,
      serviceIds: new Set(),
      unsubscribe: brokerSide.onMessage((envelope) => {
        this.routeIncoming(envelope, brokerSide);
      }),
      hostInterface: this.localHost,
    });

    // Listen on the client transport (main thread).
    this.unsubscribe = this.clientTransport.onMessage((envelope) => {
      this.routeIncoming(envelope, this.clientTransport);
    });
  }

  /** Stop the broker and close all hosts. */
  async stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.localHost?.stop();
    this.localHostTransport?.close();
    for (const [, host] of this.hosts) {
      if (host.hostInterface) continue; // local host already stopped
      host.unsubscribe();
      host.transport.close();
    }
    const hostCount = this.hosts.size;
    this.hosts.clear();
    this.serviceToHost.clear();
    this.callOrigins.clear();
    this.localHost = null;
    this.localHostTransport = null;
    log.info('broker stopped', { hostsClosed: hostCount });
  }

  /**
   * Route an incoming envelope from any transport. This is the single unified
   * entry point for all messages the broker receives, whether from the client
   * (main thread) or from a host (local or remote).
   *
   * - `call` and `behaviour` messages are routed to the target service's host.
   *   The origin transport is recorded so the return can be routed back.
   * - `return` and `error` messages are routed to the transport that issued the
   *   corresponding call, looked up by message ID.
   * - Registration control messages are handled inline.
   *
   * @param envelope The incoming envelope.
   * @param sourceTransport The transport the envelope arrived on. For calls
   *   and behaviours, this is where the return should be sent. For returns and
   *   errors, this is the host that produced the response.
   */
  private routeIncoming(envelope: Envelope, sourceTransport: Transport): void {
    const { type } = envelope.head;

    if (type === 'return' || type === 'error') {
      // Route the response back to the caller.
      const origin = this.callOrigins.get(envelope.head.messageId);
      if (origin) {
        this.callOrigins.delete(envelope.head.messageId);
        origin.send(envelope);
      } else {
        log.warn('return/error for unknown message ID', {
          messageId: envelope.head.messageId,
          type,
        });
      }
      return;
    }

    // call or behaviour
    // Check for registration control messages from the client transport.
    if (
      envelope.head.service === '__runtime' &&
      envelope.head.function === '__registerService' &&
      sourceTransport === this.clientTransport
    ) {
      const registration = envelope.body as ServiceRegistration;
      this.register(registration);
      sourceTransport.send({
        head: {
          messageId: envelope.head.messageId,
          service: '__runtime',
          function: '__registerService',
          type: 'return',
          transferables: [],
        },
        body: undefined,
      });
      return;
    }

    void this.routeCall(envelope, sourceTransport);
  }

  /**
   * Route a `call` or `behaviour` message to the host assigned to the target
   * service, launching or activating a host if necessary.
   *
   * For `call` messages, the source transport is recorded so the return can be
   * routed back to the correct caller.
   *
   * @see specs/runtime.spec.md#on-demand-activation
   */
  private async routeCall(envelope: Envelope, sourceTransport: Transport): Promise<void> {
    const { service } = envelope.head;

    const registration = this.registrations.get(service);
    if (!registration) {
      log.warn('call to unregistered service', { service, messageId: envelope.head.messageId });
      if (envelope.head.type === 'call') {
        this.sendResponse(sourceTransport, envelope, 'error', {
          name: 'ServiceNotRegisteredError',
          code: 'SERVICE_NOT_REGISTERED',
          message: `Service "${service}" is not registered with the broker`,
        });
      }
      return;
    }

    // Track where the call came from so the return can be routed back.
    if (envelope.head.type === 'call') {
      this.callOrigins.set(envelope.head.messageId, sourceTransport);
    }

    // Ensure a host is active for the service.
    let hostId = this.serviceToHost.get(service);
    if (!hostId) {
      hostId = await this.ensureHostForService(service);
    }

    const host = this.hosts.get(hostId);
    if (!host) {
      if (envelope.head.type === 'call') {
        this.callOrigins.delete(envelope.head.messageId);
        this.sendResponse(sourceTransport, envelope, 'error', {
          name: 'HostUnavailableError',
          code: 'HOST_UNAVAILABLE',
          message: `Host for service "${service}" is not available`,
        });
      }
      return;
    }

    log.debug('routing message', {
      service,
      function: envelope.head.function,
      type: envelope.head.type,
      messageId: envelope.head.messageId,
      hostId,
    });

    // Dispatch to the host: directly for the local host, via transport for
    // remote hosts.
    if (host.hostInterface) {
      host.hostInterface.dispatch(envelope);
    } else {
      host.transport.send(envelope);
    }
  }

  /**
   * Ensure a host is active for the given service.
   */
  private async ensureHostForService(serviceId: ServiceId): Promise<string> {
    const registration = this.registrations.get(serviceId);
    if (!registration) {
      throw new HostUnavailableError(`No registration for service "${serviceId}"`);
    }

    if (registration.metadata?.onBroker) {
      return this.activateOnLocalHost(registration);
    }

    if (!this.spawner) {
      return this.activateOnLocalHost(registration);
    }

    const hostId = `host-${++this.hostCounter}`;
    const launched = await this.spawner.launch([registration]);

    const host: BrokerHost = {
      transport: launched.transport,
      serviceIds: new Set([serviceId]),
      unsubscribe: launched.transport.onMessage((envelope) => {
        this.routeIncoming(envelope, launched.transport);
      }),
      hostInterface: null,
    };

    this.hosts.set(hostId, host);
    this.serviceToHost.set(serviceId, hostId);
    log.info('remote host launched', { serviceId, hostId });
    return hostId;
  }

  /**
   * Activate a service on the broker's local host.
   */
  private activateOnLocalHost(registration: ServiceRegistration): string {
    if (!this.localHost || !this.resolver) {
      throw new HostUnavailableError(
        `Cannot activate service "${registration.id}" on local host: no local host or resolver`,
      );
    }

    const declaration = this.resolver(registration.id, registration.moduleSpecifier);
    if (!declaration) {
      throw new HostUnavailableError(
        `No declaration resolved for service "${registration.id}" from "${registration.moduleSpecifier}"`,
      );
    }

    if (this.localHost.hasService(registration.id)) {
      return 'local';
    }

    void declaration.implementationLoader().then((implClass) => {
      this.localHost!.activate(declaration, implClass);
    });

    const localHost = this.hosts.get('local');
    if (localHost) {
      localHost.serviceIds.add(registration.id);
    }
    this.serviceToHost.set(registration.id, 'local');
    log.info('service activated on local host', { serviceId: registration.id });
    return 'local';
  }

  /**
   * Send a return or error response to a specific transport.
   */
  private sendResponse(
    transport: Transport,
    callEnvelope: Envelope,
    type: 'return' | 'error',
    body: unknown,
  ): void {
    const envelope: Envelope = {
      head: {
        messageId: callEnvelope.head.messageId,
        service: callEnvelope.head.service,
        function: callEnvelope.head.function,
        type,
        transferables: [],
      },
      body,
    };
    transport.send(envelope);
  }
}

/**
 * A `HostSpawner` that launches hosts in-process, using an in-process transport
 * pair. This is used for testing and for environments where Web Worker
 * isolation is not required.
 */
export class InProcessHostSpawner implements HostSpawner {
  constructor(
    private readonly resolver: ServiceModuleResolver,
    private readonly hostContext: HostContext,
  ) {}

  async launch(
    services: ServiceRegistration[],
  ): Promise<{ transport: Transport; serviceIds: string[] }> {
    const { a, b } = createInProcessTransportPair();
    // Create a RuntimeClient for the host, wired to the host's transport.
    // This enables service-to-service calls: the host's RuntimeClient sends
    // calls on transport `b`, which arrive at transport `a` (the broker side),
    // where the broker routes them and returns responses.
    const client = new RuntimeClient(b);
    const hostContext: HostContext = { ...this.hostContext, client };
    const host = new ServiceHost(b, hostContext);
    const serviceIds: string[] = [];
    for (const registration of services) {
      const declaration = this.resolver(registration.id, registration.moduleSpecifier);
      if (!declaration) {
        throw new HostUnavailableError(
          `No declaration resolved for service "${registration.id}" from "${registration.moduleSpecifier}"`,
        );
      }
      const implementationClass = await declaration.implementationLoader();
      host.activate(declaration, implementationClass);
      serviceIds.push(registration.id);
    }
    host.start();
    return { transport: a, serviceIds };
  }
}
