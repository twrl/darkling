import type { ServiceDeclaration } from './declaration.js';
import type { ServiceCallContext } from './service-call-context.js';

/**
 * Context provided to a {@link ServiceImplementation} by the
 * {@link ServiceHost} that runs it. This is the narrower interface passed to
 * the implementation's constructor, giving it access to host capabilities
 * without coupling it to the full `ServiceHost`.
 *
 * The host context exposes what an implementation needs at construction time:
 * access to other services (via a service client) and host lifecycle
 * information. Per-call context (service ID, function name, message ID) is
 * provided separately via {@link ServiceCallContext} on each function
 * invocation.
 *
 * @see specs/service-bus.spec.md#servicehost
 */
export interface HostContext {
  /**
   * A `ServiceClient` connected to the broker, enabling the implementation to
   * create proxies and invoke other services on the bus. This satisfies the
   * spec's requirement that the `ServiceClient` is available within service
   * hosts.
   *
   * @see specs/service-bus.spec.md#serviceclient
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: any;
}

/**
 * An abstract base class for service implementations. A service implementation
 * is a class that extends `ServiceImplementation`, providing methods matching
 * the functions declared in its {@link ServiceDeclaration}.
 *
 * The implementation receives a {@link HostContext} in its constructor, giving
 * it access to the host's capabilities (e.g. a service client for
 * service-to-service calls). Each function method receives the validated
 * parameters and a per-call {@link ServiceCallContext}.
 *
 * @see specs/service-bus.spec.md#service-interface-contract
 */
export abstract class ServiceImplementation<T extends ServiceDeclaration = ServiceDeclaration> {
  constructor(_hostContext: HostContext) {}

  /**
   * Look up a function by name and invoke it. This is called by the
   * `ServiceHost` when dispatching a call. Subclasses implement their
   * functions as methods; this method dispatches by name.
   *
   * The default implementation looks up the method on `this` by name.
   * Subclasses may override this for custom dispatch logic.
   */
  abstract invoke(
    functionName: keyof T['functions'],
    params: unknown,
    context: ServiceCallContext,
  ): Promise<unknown>;
}
