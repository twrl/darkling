import { createContext } from '@lit/context';
import type { Context } from '@lit/context';

import type { ServiceClient } from '../service-client.js';

/**
 * A Lit context key for the `ServiceClient`. Consumer elements retrieve the
 * `ServiceClient` from the nearest ancestor `<service-bus-host>` element via
 * this context.
 *
 * The context value is `undefined` when no `<service-bus-host>` ancestor is
 * present, allowing consumers to detect the absence gracefully.
 *
 * @example
 * ```ts
 * import { consumeServiceClient } from '@darkling/service-bus/lit';
 *
 * class MyElement extends LitElement {
 *   @consumeServiceClient()
 *   client?: ServiceClient;
 * }
 * ```
 */
export const serviceClientContext: Context<unknown, ServiceClient | undefined> = createContext<
  ServiceClient | undefined
>('darkling-service-bus:service-client');
