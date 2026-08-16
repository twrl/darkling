import { consume } from '@lit/context';
import { ContextConsumer } from '@lit/context';
import type { ReactiveElement } from 'lit';

import { serviceClientContext } from './service-client-context.js';
import type { ServiceClient } from '../service-client.js';

/**
 * A property decorator that consumes the `ServiceClient` from the nearest
 * ancestor `<service-bus-host>` element via Lit's context mechanism.
 *
 * The decorated property is updated automatically when the context value
 * changes (e.g. when the host connects or disconnects).
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { customElement } from 'lit/decorators.js';
 * import { consumeServiceClient } from '@darkling/service-bus/lit';
 *
 * @customElement('my-consumer')
 * class MyConsumer extends LitElement {
 *   @consumeServiceClient()
 *   client?: ServiceClient;
 * }
 * ```
 */
export function consumeServiceClient() {
  return consume({ context: serviceClientContext, subscribe: true });
}

/**
 * A hook for accessing the `ServiceClient` from a reactive element without a
 * decorator. Intended for use in elements that can't use decorators (e.g.
 * when using Lit's `LitElement` without decorators).
 *
 * The `ContextConsumer` is a `ReactiveController`; it is automatically cleaned
 * up when the host element disconnects. There is no manual unsubscribe.
 *
 * @param host The reactive element to attach the consumer to.
 * @param callback Called when the context value changes.
 */
export function useServiceClient(
  host: ReactiveElement,
  callback: (client: ServiceClient | undefined) => void,
): void {
  new ContextConsumer(host, {
    context: serviceClientContext,
    callback,
    subscribe: true,
  });
}
