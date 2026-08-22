/**
 * A property decorator and hook for consuming the shared-state
 * {@link LocalCopy} from the nearest ancestor `<state-manager-host>` element
 * via Lit's context mechanism.
 *
 * The decorated property is updated automatically when the context value
 * changes (e.g. when the host connects or disconnects).
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { customElement } from 'lit/decorators.js';
 * import { consumeState, SignalWatcher, watch } from '@darkling/state-manager/lit';
 *
 * @customElement('my-consumer')
 * class MyConsumer extends SignalWatcher(LitElement) {
 *   @consumeState()
 *   state?: LocalCopy;
 *
 *   override render() {
 *     return html`count is ${watch(this.state!.signal('session'))}`;
 *   }
 * }
 * ```
 */

import { consume } from '@lit/context';
import { ContextConsumer } from '@lit/context';
import type { ReactiveElement } from 'lit';

import { stateClientContext } from './state-client-context.js';
import type { LocalCopy } from '../local-copy.js';

/**
 * A property decorator that consumes the {@link LocalCopy} from the nearest
 * ancestor `<state-manager-host>` element via Lit's context mechanism.
 */
export function consumeState() {
  return consume({ context: stateClientContext, subscribe: true });
}

/**
 * A hook for accessing the {@link LocalCopy} from a reactive element without a
 * decorator. Intended for elements that can't use decorators.
 *
 * The `ContextConsumer` is a `ReactiveController`; it is automatically cleaned
 * up when the host element disconnects. There is no manual unsubscribe.
 *
 * @param host The reactive element to attach the consumer to.
 * @param callback Called when the context value changes.
 */
export function useState(
  host: ReactiveElement,
  callback: (state: LocalCopy | undefined) => void,
): void {
  new ContextConsumer(host, {
    context: stateClientContext,
    callback,
    subscribe: true,
  });
}
