/**
 * A Lit context key for the shared-state {@link LocalCopy}. Consumer elements
 * retrieve the `LocalCopy` from the nearest ancestor `<state-manager-host>`
 * element via this context.
 *
 * The context value is `undefined` when no `<state-manager-host>` ancestor is
 * present, allowing consumers to detect the absence gracefully.
 *
 * @example
 * ```ts
 * import { consumeState } from '@darkling/state-manager/lit';
 *
 * class MyElement extends LitElement {
 *   @consumeState()
 *   state?: LocalCopy;
 * }
 * ```
 */

import { createContext } from '@lit/context';
import type { Context } from '@lit/context';

import type { LocalCopy } from '../local-copy.js';

export const stateClientContext: Context<unknown, LocalCopy | undefined> = createContext<
  LocalCopy | undefined
>('darkling-state-manager:local-copy');
