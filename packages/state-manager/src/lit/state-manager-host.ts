/**
 * A Lit custom element that owns a {@link LocalCopy} and provides it to
 * descendant elements via Lit's context mechanism.
 *
 * The element consumes the `ServiceClient` from the nearest ancestor
 * `<service-bus-host>` (provided by `@darkling/service-bus/lit`) and uses it
 * to build a {@link SnapshotFetcher} backed by a typed proxy to the state
 * manager authority service. It creates a {@link PatchChannel} over a
 * `BroadcastChannel` and a {@link LocalCopy}, fetches the initial snapshots
 * on connect, and disposes on disconnect.
 *
 * Descendant elements consume the {@link LocalCopy} via the
 * {@link consumeState} decorator or {@link useState} hook, and render shared
 * state reactively using `SignalWatcher` and `watch` from `@lit-labs/signals`.
 *
 * This element is defined imperatively (without TypeScript decorators) so it
 * works with both standard and experimental decorator configurations. The
 * custom element is registered as `<state-manager-host>`.
 *
 * @see specs/state-manager.spec.md#local-copies
 * @see specs/state-manager.spec.md#initialisation
 */

import { LitElement } from 'lit';
import { ContextConsumer, ContextProvider } from '@lit/context';
import type { Context } from '@lit/context';
import type { ServiceClient, ServiceDeclaration } from '@darkling/service-bus';
import { serviceClientContext } from '@darkling/service-bus/lit';

import { createPatchChannel, type PatchChannel } from '../broadcast.js';
import { createLocalCopy, type LocalCopy, type SnapshotFetcher } from '../local-copy.js';
import { declaration as stateManagerDeclaration } from '../service-declaration.js';

import { stateClientContext } from './state-client-context.js';

/**
 * Options for the `<state-manager-host>` element.
 */
export interface StateManagerHostOptions {
  /** The slices this local copy consumes, by identifier. */
  slices: ReadonlyArray<string>;
  /** The name of the `BroadcastChannel` used for patch broadcast. */
  channelName: string;
}

/** A typed proxy to the state manager authority service. */
interface StateManagerProxy {
  getSnapshot: (params: { slice: string }) => Promise<{ value: unknown; seq: number }>;
}

/**
 * Build a {@link SnapshotFetcher} from a `ServiceClient` by creating a typed
 * proxy to the state manager authority service. Exported so consumers can
 * build a fetcher outside a `<state-manager-host>` (e.g. in a worker).
 */
export function createBusSnapshotFetcher(
  client: ServiceClient,
  declaration: ServiceDeclaration = stateManagerDeclaration,
): SnapshotFetcher {
  const proxy = client.createProxy(declaration) as unknown as StateManagerProxy;
  return {
    async getSnapshot(slice) {
      return proxy.getSnapshot({ slice });
    },
  };
}

/**
 * A Lit custom element that hosts a {@link LocalCopy} and provides it to
 * descendant elements via context.
 *
 * The element consumes the `ServiceClient` from the nearest ancestor
 * `<service-bus-host>` element. It must be a descendant of a
 * `<service-bus-host>`.
 *
 * @example
 * ```ts
 * import { html, LitElement } from 'lit';
 * import { StateManagerHost, type StateManagerHostOptions } from '@darkling/state-manager/lit';
 *
 * const options: StateManagerHostOptions = {
 *   slices: ['interface', 'session'],
 *   channelName: 'darkling-state',
 * };
 *
 * // In a parent element's render, nested under a <service-bus-host>:
 * // html`<state-manager-host .options=${options}><my-consumer></my-consumer></state-manager-host>`
 * ```
 */
export class StateManagerHost extends LitElement {
  /**
   * Options for the local copy. A reactive property: may be set before the
   * element connects to the DOM or after; setting it while connected restarts
   * the local copy (via the `updated()` handler).
   */
  // Declared as a reactive property imperatively (no decorator) so the element
  // works with both standard and experimental decorator configurations. The
  // `declare` modifier gives a type without emitting a class field that would
  // shadow Lit's change-detecting accessor.
  static override properties = {
    options: { type: Object },
  };

  declare options: StateManagerHostOptions | undefined;

  /** The `LocalCopy` provided to descendants via context. */
  get localCopy(): LocalCopy | undefined {
    return this._localCopy;
  }

  private _client: ServiceClient | undefined;
  private _localCopy: LocalCopy | undefined;
  private _channel: PatchChannel | undefined;
  private _provider: ContextProvider<
    Context<unknown, LocalCopy | undefined>,
    StateManagerHost
  > | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._provider = new ContextProvider(this, {
      context: stateClientContext,
      initialValue: undefined,
    });
    // Consume the ServiceClient from the nearest <service-bus-host>.
    new ContextConsumer(this, {
      context: serviceClientContext,
      callback: (client: ServiceClient | undefined) => {
        this._client = client;
        void this._restart();
      },
      subscribe: true,
    });
    this._start();
  }

  override disconnectedCallback(): void {
    this._stop();
    super.disconnectedCallback();
  }

  protected override updated(changedProps: Map<string, unknown>): void {
    super.updated(changedProps);
    if (changedProps.has('options') && this.isConnected) {
      void this._restart();
    }
  }

  private _start(): void {
    if (!this._client || !this.options) return;
    if (this._localCopy) return;
    this._channel = createPatchChannel({ channelName: this.options.channelName });
    const fetcher = createBusSnapshotFetcher(this._client);
    this._localCopy = createLocalCopy({
      slices: this.options.slices,
      channel: this._channel,
      fetcher,
    });
    void this._localCopy.init();
    this._provider?.setValue(this._localCopy);
  }

  private _stop(): void {
    this._localCopy?.dispose();
    this._channel?.close();
    this._localCopy = undefined;
    this._channel = undefined;
    this._provider?.setValue(undefined);
  }

  private async _restart(): Promise<void> {
    this._stop();
    this._start();
  }
}
