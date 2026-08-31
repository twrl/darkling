import type { ServiceDeclaration } from './declaration.js';
import type { ServiceCallContext } from './service-call-context.js';
import type { RuntimeClient } from './runtime-client.js';
import type { RegistryUpdateCallback } from './service-broker.js';

export type { ServiceCallContext };

/**
 * Context provided to a {@link ServiceImplementation} by the
 * `ServiceHost` that runs it. This is the narrower interface passed to the
 * implementation's constructor, giving it access to the runtime.
 *
 * The host context exposes what an implementation needs at construction time:
 * a `RuntimeClient` for invoking other services, dispatching behaviours, and
 * committing mutations. Per-call context (service ID, function name, message
 * ID) is provided separately via {@link ServiceCallContext} on each invocation.
 *
 * The host context must not carry service configuration options. Configuration
 * flows through the [initializer](../../specs/runtime.spec.md#initialization)
 * behaviour's parameters.
 *
 * @see specs/runtime.spec.md#host-context
 */
export interface HostContext {
  /**
   * A `RuntimeClient` for invoking other services, dispatching behaviours,
   * and committing mutations.
   */
  client: RuntimeClient;
  /**
   * An optional callback for registry updates. Set by the broker so that
   * colocated services (specifically the state authority) can update the
   * registry pseudo-slice directly.
   */
  registryCallback?: RegistryUpdateCallback;
}

/**
 * An abstract base class for service implementations. A service implementation
 * is a class that extends `ServiceImplementation` and declares methods matching
 * the function and behaviour names in its {@link ServiceDeclaration}.
 *
 * The implementation receives a {@link HostContext} in its constructor, giving
 * it access to the runtime. The host calls the implementation's methods by name
 * (e.g. `impl.add(params, context)`) — the host itself handles parameter
 * validation (using the declaration's Zod schemas) and return validation.
 *
 * The base class exists primarily to give implementations access to the
 * {@link HostContext} via `this.hostContext`. Implementations are free to
 * declare their methods with whatever signatures are idiomatic; the host calls
 * `(impl as any)[functionName](params, context)`.
 *
 * @see specs/runtime.spec.md#service-interface-contract
 */
export abstract class ServiceImplementation<T extends ServiceDeclaration = ServiceDeclaration> {
  /** The host context, providing access to the runtime. */
  protected readonly hostContext: HostContext;

  constructor(hostContext: HostContext) {
    this.hostContext = hostContext;
  }
}
