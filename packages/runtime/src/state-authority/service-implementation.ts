/**
 * The state authority service implementation. Owns an {@link Authority} and
 * dispatches `mutate`, `getSnapshot`, `getRegistry`, and `registerSlice` calls
 * to it, plus the `initialize` behaviour.
 *
 * This module is loaded lazily by the service declaration's
 * `implementationLoader`, so that the implementation is kept out of the
 * initial bundle and loaded on demand by the host.
 *
 * The authority's configuration (the broadcast channel name and optional
 * initial values) flows through the initializer behaviour's parameters, per
 * the [initialization protocol](../../specs/runtime.spec.md#initialization).
 *
 * @see specs/runtime.spec.md#state-authority
 */

import type { HostContext } from '../service-implementation.js';
import type { ServiceCallContext } from '../service-call-context.js';
import { ServiceImplementation } from '../service-implementation.js';

import { Authority } from '../authority.js';
import { createPatchChannel, type PatchChannel } from '../broadcast.js';
import type { SliceDeclaration } from '../state-model.js';
import type { SliceRegistration, RegistryValue } from '../registration.js';

/**
 * Parameters for the authority's `initialize` behaviour. Carries the
 * configuration that was previously passed through `HostContext` options.
 * Must be structured-clonable, as it crosses `postMessage` when the
 * authority is activated on a broker worker host.
 */
export interface StateAuthorityInitializeParams {
  /** The name of the `BroadcastChannel` used for state-change propagation. */
  channelName: string;
  /**
   * Optional initial values for slices, keyed by slice identifier.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialValues?: Record<string, any>;
}

/**
 * The state authority service implementation. Owns an {@link Authority} and
 * dispatches calls to it.
 *
 * The authority is activated with an `initialize` behaviour that provides the
 * broadcast channel name and initial values. Until the initializer is called,
 * the authority is in `activating_2` state and all calls are queued.
 *
 * @see specs/runtime.spec.md#state-authority
 */
export class StateAuthorityService extends ServiceImplementation {
  private authority: Authority | null = null;
  private channel: PatchChannel | null = null;
  private initializeParams: StateAuthorityInitializeParams | null = null;

  constructor(hostContext: HostContext) {
    super(hostContext);
  }

  /**
   * The initializer behaviour. Called by the bootstrap code with the
   * broadcast channel name and optional initial values.
   */
  initialize(params: StateAuthorityInitializeParams, _context: ServiceCallContext): void {
    this.initializeParams = params;
    this.channel = createPatchChannel({
      channelName: params.channelName,
    });
    this.authority = new Authority(this.channel);

    // Wire the broker's registry callback to the authority.
    if (this.hostContext.registryCallback) {
      this.authority.setRegistryUpdateCallback(this.hostContext.registryCallback);
    }

    if (params.initialValues) {
      for (const [id, value] of Object.entries(params.initialValues)) {
        try {
          this.authority!.init(id, value);
        } catch {
          // Slice not registered yet; skip.
        }
      }
    }
  }

  async mutate(
    params: {
      slice: string;
      mutation: string;
      params: unknown;
      basisSeq: number;
    },
    _context: ServiceCallContext,
  ) {
    if (!this.authority) throw new Error('State authority not initialized');
    return this.authority.mutate(params);
  }

  async getSnapshot(params: { slice: string }, _context: ServiceCallContext) {
    if (!this.authority) throw new Error('State authority not initialized');
    return this.authority.getSnapshot(params.slice);
  }

  async getRegistry(_params: unknown, _context: ServiceCallContext) {
    if (!this.authority) throw new Error('State authority not initialized');
    return this.authority.getRegistry();
  }

  async registerSlice(params: SliceRegistration, _context: ServiceCallContext) {
    if (!this.authority) throw new Error('State authority not initialized');
    const mod = (await import(/* @vite-ignore */ params.moduleSpecifier)) as {
      default: SliceDeclaration;
    };
    this.authority.registerSlice(mod.default);

    if (this.initializeParams?.initialValues?.[params.id] !== undefined) {
      this.authority.init(params.id, this.initializeParams.initialValues[params.id]);
    }

    return {};
  }

  dispose(): void {
    this.channel?.close();
  }
}
