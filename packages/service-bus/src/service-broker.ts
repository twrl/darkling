import { HostUnavailableError } from './errors.js';
import type { Envelope, ServiceId } from './envelope.js';
import type { Transport } from './transport.js';
import { createInProcessTransportPair } from './in-process-transport.js';
import type { HostSpawner, HostLaunchRequest, LaunchedHost } from './host-spawner.js';
import type { ServiceRegistration } from './service-module-registry.js';
import { ServiceModuleRegistry } from './service-module-registry.js';
import type { ServiceDeclaration } from './declaration.js';
import type { HostContext } from './service-implementation.js';
import { ServiceHost } from './service-host.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('service-bus:broker');

/**
 * A host tracked by the broker: its transport and the service IDs it has
 * activated.
 */
interface BrokerHost {
  transport: Transport;
  serviceIds: Set<string>;
  unsubscribe: () => void;
}

/**
 * The `ServiceBroker` is the central routing and coordination point for the
 * service bus. It runs in a Web Worker.
 *
 * The broker:
 * - routes messages between service clients and service hosts;
 * - maintains the service registry — serializable registration records (ID,
 *   module specifier, metadata) only; it does not hold live declarations or
 *   implementations;
 * - decides when to launch a new host and when to activate a service, and on
 *   which host, informed by service metadata;
 * - handles Transferable objects in message envelopes;
 * - routes return and error messages back to the `ServiceClient`.
 *
 * The broker delegates parameter and return validation to the host, which
 * imports the service module to obtain live Zod schemas. This keeps the
 * broker free of non-serializable objects, allowing it to run in a Web Worker
 * receiving registrations via `postMessage`.
 *
 * @see specs/service-bus.spec.md#servicebroker
 */
export class ServiceBroker {
  private readonly clientTransport: Transport;
  private readonly spawner: HostSpawner;
  private readonly registry: ServiceModuleRegistry;
  private readonly hosts = new Map<string, BrokerHost>();
  private readonly serviceToHost = new Map<ServiceId, string>();
  private hostCounter = 0;
  private unsubscribe: (() => void) | null = null;

  /**
   * @param clientTransport Transport endpoint connected to the `ServiceClient`.
   * @param spawner The host spawner used to launch hosts on demand.
   * @param registry The service registration registry. If omitted, an empty
   *   registry is created; use `register` to add services.
   */
  constructor(
    clientTransport: Transport,
    spawner: HostSpawner,
    registry: ServiceModuleRegistry = new ServiceModuleRegistry(),
  ) {
    this.clientTransport = clientTransport;
    this.spawner = spawner;
    this.registry = registry;
  }

  /**
   * Register a service with the broker: its ID, module specifier, and metadata.
   * Each service must be registered before it can be invoked.
   *
   * The registration record is serializable (ID + module specifier +
   * metadata). The broker does not hold the live declaration or implementation;
   * those are obtained by the host worker importing the module.
   *
   * @see specs/service-bus.spec.md#service-registration
   */
  register(registration: ServiceRegistration): void {
    this.registry.register(registration);
  }

  /** Start the broker, listening for messages from the client transport. */
  start(): void {
    if (this.unsubscribe) return;
    log.info('broker starting');
    this.unsubscribe = this.clientTransport.onMessage((envelope) => {
      void this.handleClientMessage(envelope);
    });
  }

  /** Stop the broker and close all hosts. */
  async stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const [, host] of this.hosts) {
      host.unsubscribe();
      host.transport.close();
    }
    const hostCount = this.hosts.size;
    this.hosts.clear();
    this.serviceToHost.clear();
    log.info('broker stopped', { hostsClosed: hostCount });
  }

  /**
   * Handle a message from a `ServiceClient` (via the client transport).
   * `call` messages are routed to the appropriate host; `return` and `error`
   * messages from hosts are routed back to the client.
   *
   * @see specs/service-bus.spec.md#routing
   */
  private async handleClientMessage(envelope: Envelope): Promise<void> {
    if (envelope.head.type === 'call') {
      await this.routeCall(envelope);
    }
    // return/error messages from the client transport are unexpected; the
    // client only sends call messages.
  }

  /**
   * Route a `call` message to the host assigned to the service, launching a
   * new host or activating the service on an existing host if necessary.
   *
   * @see specs/service-bus.spec.md#on-demand-activation
   */
  private async routeCall(envelope: Envelope): Promise<void> {
    const { service } = envelope.head;
    const entry = this.registry.get(service);
    if (!entry) {
      log.warn('call to unregistered service', { service, messageId: envelope.head.messageId });
      this.sendErrorToClient(envelope, {
        name: 'ServiceNotRegisteredError',
        code: 'SERVICE_NOT_REGISTERED',
        message: `Service "${service}" is not registered with the broker`,
      });
      return;
    }

    // Determine whether a host capable of executing the service is already
    // active. If not, launch a new host (or activate the service on an
    // existing host) before dispatching the call.
    let hostId = this.serviceToHost.get(service);
    if (!hostId) {
      log.debug('launching host for service', { service });
      hostId = await this.ensureHostForService(service);
    }

    const host = this.hosts.get(hostId);
    if (!host) {
      log.error('host unavailable after launch', { service, hostId });
      this.sendErrorToClient(envelope, {
        name: 'HostUnavailableError',
        code: 'HOST_UNAVAILABLE',
        message: `Host for service "${service}" is not available`,
      });
      return;
    }

    log.debug('routing call', {
      service,
      function: envelope.head.function,
      messageId: envelope.head.messageId,
      hostId,
    });
    // The broker passes the envelope to the host. Transferable objects are
    // referenced in the head's transferables field, passed verbatim.
    host.transport.send(envelope);
  }

  /**
   * Ensure a host is active for the given service. The broker decides when to
   * launch a new host versus activating the service on an existing host,
   * informed by service metadata.
   */
  private async ensureHostForService(serviceId: ServiceId): Promise<string> {
    const registration = this.registry.get(serviceId);
    if (!registration) {
      throw new HostUnavailableError(`No registration for service "${serviceId}"`);
    }

    // Broker policy: if an existing host already supports a compatible
    // service and the new service prefers sharing, activate on that host.
    // For the initial implementation, we launch a dedicated host per service
    // unless the service declares `preferSharedHost` and a suitable host
    // exists.
    if (registration.metadata?.preferSharedHost) {
      for (const [existingHostId, host] of this.hosts) {
        // Activate on an existing host that supports services with the same
        // capabilities.
        const compatible = host.serviceIds.size > 0;
        if (compatible) {
          // We cannot activate on an existing in-process host after launch in
          // the current spawner model; fall through to launching a new host.
          break;
        }
        void existingHostId;
      }
    }

    const hostId = `host-${++this.hostCounter}`;
    const launchRequests: HostLaunchRequest[] = [
      { serviceId: registration.id, moduleSpecifier: registration.moduleSpecifier },
    ];
    const launched = await this.spawner.launch(launchRequests);

    const host: BrokerHost = {
      transport: launched.transport,
      serviceIds: new Set([serviceId]),
      unsubscribe: launched.transport.onMessage((returnEnvelope) => {
        // Route return and error messages back to the ServiceClient.
        this.clientTransport.send(returnEnvelope);
      }),
    };

    this.hosts.set(hostId, host);
    this.serviceToHost.set(serviceId, hostId);
    log.info('host launched', { serviceId, hostId });
    return hostId;
  }

  private sendErrorToClient(callEnvelope: Envelope, errorBody: unknown): void {
    const errorEnvelope: Envelope = {
      head: {
        messageId: callEnvelope.head.messageId,
        service: callEnvelope.head.service,
        function: callEnvelope.head.function,
        type: 'error',
        transferables: [],
      },
      body: errorBody,
    };
    this.clientTransport.send(errorEnvelope);
  }
}

/**
 * A resolver that maps service IDs to their live declaration. Used by the
 * {@link InProcessHostSpawner} to obtain the declaration (which carries its
 * own `implementationLoader`).
 *
 * In a worker-based spawner, this resolution happens via dynamic import of the
 * module specifier; in-process, a resolver function provides the live
 * declaration directly. The implementation is obtained by calling the
 * declaration's `implementationLoader`.
 */
export type ServiceModuleResolver = (
  serviceId: string,
  moduleSpecifier: ModuleSpecifier,
) => ServiceDeclaration | undefined;

import type { ModuleSpecifier } from './service-module-registry.js';

/**
 * A `HostSpawner` that launches hosts in-process, using an in-process transport
 * pair. This is used for testing and for environments where Web Worker
 * isolation is not required.
 *
 * Declarations are resolved via a {@link ServiceModuleResolver} function, and
 * implementations are obtained by calling each declaration's
 * `implementationLoader`. A worker-based spawner would use the module
 * specifiers via `import()` instead.
 *
 * @see specs/service-bus.spec.md#on-demand-activation
 */
export class InProcessHostSpawner implements HostSpawner {
  /**
   * @param resolver A function that resolves a service ID and module specifier
   *   to its live declaration.
   * @param hostContext The context provided to each service implementation's
   *   constructor, giving it access to the bus.
   */
  constructor(
    private readonly resolver: ServiceModuleResolver,
    private readonly hostContext: HostContext,
  ) {}

  async launch(services: HostLaunchRequest[]): Promise<LaunchedHost> {
    const { a, b } = createInProcessTransportPair();
    const host = new ServiceHost(b, this.hostContext);
    const serviceIds: string[] = [];
    for (const { serviceId, moduleSpecifier } of services) {
      const declaration = this.resolver(serviceId, moduleSpecifier);
      if (!declaration) {
        throw new HostUnavailableError(
          `No declaration resolved for service "${serviceId}" from "${moduleSpecifier}"`,
        );
      }
      const implementationClass = await declaration.implementationLoader();
      host.activate(declaration, implementationClass);
      serviceIds.push(serviceId);
    }
    host.start();
    return { transport: a, serviceIds };
  }
}
