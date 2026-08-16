import { LitElement } from 'lit';
import { ContextProvider } from '@lit/context';
import type { Context } from '@lit/context';

import { ServiceBus } from '../service-bus.js';
import type { ServiceBusOptions, BrokerFactory } from '../service-bus.js';
import type { ServiceClient } from '../service-client.js';
import type { ServiceRegistration } from '../service-module-registry.js';
import { createWorkerBrokerFactory } from '../worker-broker-factory.js';
import type { WorkerUrl } from '../worker-protocol.js';

import { serviceClientContext } from './service-client-context.js';

/**
 * Options for the `<service-bus-host>` element.
 *
 * The element defaults to a worker-based broker. Provide `brokerWorkerUrl`
 * and `hostWorkerUrl` and the element will construct the broker factory
 * internally via `createWorkerBrokerFactory`. For testing or advanced use
 * cases, provide `brokerFactory` directly — this takes precedence over the
 * URL options.
 */
export interface ServiceBusHostOptions {
  /**
   * The URL of the broker worker entry point. When provided alongside
   * `hostWorkerUrl`, the element constructs a worker-based broker factory
   * automatically. Ignored if `brokerFactory` is provided.
   */
  brokerWorkerUrl?: WorkerUrl;
  /**
   * The URL of the host worker entry point, forwarded to the broker worker.
   * Ignored if `brokerFactory` is provided.
   */
  hostWorkerUrl?: WorkerUrl;
  /**
   * A factory that constructs the broker. When provided, this takes
   * precedence over the URL options. Use this for in-process testing (via
   * `createInProcessBrokerFactory`) or custom broker setups.
   */
  brokerFactory?: BrokerFactory;
  /** Service registrations to apply when the host connects. */
  registrations?: ServiceRegistration[];
}

/**
 * A Lit custom element that hosts the `ServiceBus` facade and provides the
 * `ServiceClient` to descendant elements via Lit's context mechanism.
 *
 * The element creates and owns a `ServiceBus` instance when it connects to the
 * DOM, and disposes it when disconnected. Descendant elements consume the
 * `ServiceClient` via the {@link consumeServiceClient} decorator or
 * {@link useServiceClient} hook.
 *
 * The `ServiceBus` options (broker worker URL, host worker URL, registrations)
 * are provided via the `options` property, which should be set before the element
 * connects (e.g. imperatively or via a parent element's render). The element
 * defaults to a worker-based broker, constructing the broker factory from the
 * provided URLs. For in-process testing, provide `brokerFactory` directly (e.g.
 * via `createInProcessBrokerFactory`).
 *
 * This element is defined imperatively (without TypeScript decorators) so it
 * works with both standard and experimental decorator configurations. The
 * custom element is registered as `<service-bus-host>`.
 *
 * @example
 * ```ts
 * import { html, LitElement } from 'lit';
 * import { ServiceBusHost, type ServiceBusHostOptions } from '@darkling/service-bus/lit';
 *
 * // Worker-based (default for browser):
 * const options: ServiceBusHostOptions = {
 *   brokerWorkerUrl: new URL('./broker-worker.ts', import.meta.url).href,
 *   hostWorkerUrl: new URL('./host-worker.ts', import.meta.url).href,
 *   registrations: [{ id: 'calculator', moduleSpecifier: './services/calculator' }],
 * };
 *
 * // In a parent element's render:
 * // html`<service-bus-host .options=${options}><my-consumer></my-consumer></service-bus-host>`
 * ```
 *
 * @see specs/service-bus.spec.md
 */
export class ServiceBusHost extends LitElement {
  /**
   * The options for the `ServiceBus`. Set this before the element connects to
   * the DOM. If the options change while connected, the `ServiceBus` is
   * recreated.
   */
  options?: ServiceBusHostOptions;

  /** The `ServiceClient` provided to descendants via context. */
  get serviceClient(): ServiceClient | undefined {
    return this._serviceClient;
  }

  private _serviceClient: ServiceClient | undefined;
  private _bus: ServiceBus | null = null;
  private _provider: ContextProvider<
    Context<unknown, ServiceClient | undefined>,
    ServiceBusHost
  > | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._provider = new ContextProvider(this, {
      context: serviceClientContext,
      initialValue: undefined,
    });
    this._startBus();
  }

  override disconnectedCallback(): void {
    void this._stopBus();
    super.disconnectedCallback();
  }

  protected override updated(changedProps: Map<string, unknown>): void {
    super.updated(changedProps);
    if (changedProps.has('options') && this.isConnected) {
      void this._restartBus();
    }
  }

  private async _startBus(): Promise<void> {
    if (this._bus || !this.options) return;

    // Resolve the broker factory: use the provided factory, or construct one
    // from the worker URLs (the default worker-based path).
    let brokerFactory = this.options.brokerFactory;
    if (!brokerFactory) {
      if (!this.options.brokerWorkerUrl || !this.options.hostWorkerUrl) {
        throw new Error(
          'ServiceBusHost requires either brokerFactory or both brokerWorkerUrl and hostWorkerUrl',
        );
      }
      brokerFactory = createWorkerBrokerFactory({
        brokerWorkerUrl: this.options.brokerWorkerUrl,
        hostWorkerUrl: this.options.hostWorkerUrl,
        registrations: this.options.registrations ?? [],
      });
    }

    const opts: ServiceBusOptions = { brokerFactory };
    this._bus = new ServiceBus(opts);
    // When using the worker factory, registrations are sent in the init
    // message. When using a custom factory, register them here.
    if (this.options.brokerFactory) {
      for (const reg of this.options.registrations ?? []) {
        this._bus.register(reg);
      }
    }
    this._serviceClient = this._bus.serviceClient;
    this._provider?.setValue(this._serviceClient);
  }

  private async _stopBus(): Promise<void> {
    if (!this._bus) return;
    this._serviceClient = undefined;
    this._provider?.setValue(undefined);
    const bus = this._bus;
    this._bus = null;
    await bus.dispose();
  }

  private async _restartBus(): Promise<void> {
    await this._stopBus();
    await this._startBus();
  }
}

// Register the custom element imperatively (no decorators needed).
customElements.define('service-bus-host', ServiceBusHost);
