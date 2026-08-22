/**
 * @darkling/state-manager/lit — Lit integration for the state manager.
 *
 * This subpath exports:
 * - a `<state-manager-host>` custom element that owns a {@link LocalCopy} and
 *   provides it to descendant elements via Lit's context mechanism;
 * - a `@consumeState()` decorator and `useState` hook for consumers;
 * - re-exports of `SignalWatcher`, `watch`, `Signal.State`, and
 *   `Signal.Computed` from `@lit-labs/signals`, so that consumer elements can
 *   render shared state reactively with the TC39 signals they already read.
 *
 * Lit, @lit/context, and @lit-labs/signals are optional peer dependencies.
 * Import this subpath only in projects that use Lit.
 */

export { stateClientContext } from './state-client-context.js';

export { consumeState, useState } from './consume-state.js';

export { StateManagerHost, type StateManagerHostOptions } from './state-manager-host.js';

// Re-export the @lit-labs/signals building blocks consumers use alongside the
// state manager, so they can import everything from one place.
export { SignalWatcher, watch } from '@lit-labs/signals';
export { Signal } from 'signal-polyfill';
