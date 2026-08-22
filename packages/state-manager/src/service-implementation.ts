/**
 * The state manager service implementation. Owns an {@link Authority} and
 * dispatches `proposeUpdate` / `getSnapshot` calls to it.
 *
 * This module is loaded lazily by the service declaration's
 * `implementationLoader`, so that the implementation is kept out of the
 * initial bundle and loaded on demand by the host worker.
 *
 * @see specs/state-manager.spec.md#authority
 */

import type { HostContext, ServiceCallContext, ServiceDeclaration } from '@darkling/service-bus';
import { ServiceImplementation } from '@darkling/service-bus';

import { Authority, type Proposal } from './authority.js';
import { createPatchChannel, type PatchChannel } from './broadcast.js';
import type { SliceDeclaration } from './model.js';

/**
 * Options for the state manager service, carried by the `HostContext`. Allows
 * the host to inject the slice registry and the broadcast channel name.
 */
export interface StateManagerServiceOptions {
  /** The fixed set of slice declarations. */
  slices: ReadonlyArray<SliceDeclaration>;
  /** The name of the `BroadcastChannel` used for patch broadcast. */
  channelName: string;
  /**
   * Optional initial values for slices, keyed by slice identifier. Slices
   * without an initial value default to `undefined` at sequence 0.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialValues?: Record<string, any>;
  /**
   * An optional factory for the `BroadcastChannel`. Defaults to the global
   * `BroadcastChannel` constructor. Provided so tests can substitute an
   * in-memory implementation.
   */
  createChannel?: (name: string) => BroadcastChannelLike;
}

/** Minimal BroadcastChannel-like interface, re-declared here to keep the options self-contained. */
interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

/**
 * The state manager service's function names, used to type the
 * `ServiceImplementation` generic parameter.
 */
export type StateManagerServiceDeclaration = ServiceDeclaration & {
  functions: {
    proposeUpdate: unknown;
    getSnapshot: unknown;
  };
};

/**
 * The state manager authority service implementation. Owns an
 * {@link Authority} and dispatches bus calls to it.
 *
 * @see specs/state-manager.spec.md#authority
 */
export class StateManagerService extends ServiceImplementation<StateManagerServiceDeclaration> {
  private readonly authority: Authority;
  private readonly channel: PatchChannel;

  constructor(hostContext: HostContext) {
    super(hostContext);
    const options = (
      hostContext as HostContext & {
        stateManager?: StateManagerServiceOptions;
      }
    ).stateManager;
    if (!options) {
      throw new Error(
        'StateManagerService requires StateManagerServiceOptions under hostContext.stateManager',
      );
    }
    const slices = new Map<string, SliceDeclaration>();
    for (const decl of options.slices) {
      if (slices.has(decl.id)) {
        throw new Error(`Duplicate slice identifier: ${decl.id}`);
      }
      slices.set(decl.id, decl);
    }
    this.channel = createPatchChannel({
      channelName: options.channelName,
      createChannel: options.createChannel,
    });
    this.authority = new Authority(slices, this.channel);
    for (const [id, value] of Object.entries(options.initialValues ?? {})) {
      this.authority.init(id, value);
    }
  }

  async invoke(
    functionName: string,
    params: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ServiceCallContext,
  ): Promise<unknown> {
    if (functionName === 'proposeUpdate') {
      const p = params as Proposal;
      return this.authority.proposeUpdate(p);
    }
    if (functionName === 'getSnapshot') {
      const p = params as { slice: string };
      return this.authority.getSnapshot(p.slice);
    }
    throw new Error(`Unknown function: ${functionName}`);
  }

  /** Close the broadcast channel. Called by the host on deactivation. */
  dispose(): void {
    this.channel.close();
  }
}
