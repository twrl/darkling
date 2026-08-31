/**
 * The state authority service declaration — exposes the authority as a
 * colocated service on the broker, as defined by
 * [State authority](../../specs/runtime.spec.md#state-authority).
 *
 * The authority is a colocated service (`onBroker: true`) that holds the
 * authoritative copy of every slice, processes mutations, validates the
 * resulting value against the slice's schema, and propagates accepted changes.
 *
 * The service exposes `mutate`, `getSnapshot`, `getRegistry`, and
 * `registerSlice` as functions, and `initialize` as a behaviour (the
 * initializer). Its proxy factory produces a store builder that wraps these
 * calls with a typed, per-slice store interface.
 *
 * This module follows the `*.service.ts` naming convention and exports the
 * `ServiceDeclaration` as its default export.
 *
 * @see specs/runtime.spec.md#state-authority
 * @see specs/runtime.spec.md#store-interface
 * @see specs/runtime.spec.md#declaration-module-and-implementation-loading
 */

import { z } from 'zod';
import type { ServiceDeclaration } from '../declaration.js';
import type { RuntimeClient } from '../runtime-client.js';
import type { StoreBuilder } from '../store-builder.js';
import type { LocalCopy } from '../local-copy.js';
import { createStoreBuilder } from '../store-builder.js';

// --- Zod schemas for the authority service functions ---

const mutationParamsSchema = z.object({
  slice: z.string(),
  mutation: z.string(),
  params: z.unknown(),
  basisSeq: z.number().int().nonnegative(),
});

const ackSchema = z.object({ seq: z.number().int().nonnegative() });

const snapshotRequestSchema = z.object({ slice: z.string() });

const snapshotSchema = z.object({
  value: z.unknown(),
  seq: z.number().int().nonnegative(),
});

const registryRequestSchema = z.object({});

const registryResponseSchema = z.object({
  services: z.record(z.string(), z.unknown()),
  slices: z.record(z.string(), z.unknown()),
});

const sliceRegistrationSchema = z.object({
  id: z.string(),
  moduleSpecifier: z.string(),
});

const emptyResponseSchema = z.object({});

const initializeParamsSchema = z.object({
  channelName: z.string(),
  initialValues: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Options for creating a state authority proxy (the store builder).
 */
export interface StateAuthorityProxyOptions {
  /** The local copy used by the store builder for reactive state. */
  localCopy: LocalCopy;
}

/**
 * The state authority service declaration.
 *
 * The `implementationLoader` dynamically imports the implementation module,
 * returning the `StateAuthorityService` constructor. The broker instantiates
 * the class with a `HostContext` on its local host.
 *
 * The `proxyFactory` produces a function that, given a `LocalCopy`, returns a
 * {@link StoreBuilder}. This is because the store builder needs a `LocalCopy`
 * which is not available at proxy creation time — it is created by the
 * consumer (e.g. a host element or explicit setup).
 *
 * @see specs/runtime.spec.md#state-authority
 * @see specs/runtime.spec.md#store-interface
 */
const declaration: ServiceDeclaration = {
  id: 'state-authority',
  functions: {
    mutate: {
      params: mutationParamsSchema,
      returns: ackSchema,
      description:
        'Submit a named mutation for a slice. The authority applies the ' +
        "mutation's transition function to the authoritative state, " +
        'validates the result, and propagates the change. Resolves with an ' +
        'ack carrying the assigned sequence number.',
    },
    getSnapshot: {
      params: snapshotRequestSchema,
      returns: snapshotSchema,
      description:
        'Return the current authoritative value of a slice together with ' +
        'its current sequence number. Used for initialisation and gap ' +
        'recovery by local copies.',
    },
    getRegistry: {
      params: registryRequestSchema,
      returns: registryResponseSchema,
      description:
        'Return the current registry pseudo-slice value, containing all ' +
        'registered services and slices.',
    },
    registerSlice: {
      params: sliceRegistrationSchema,
      returns: emptyResponseSchema,
      description:
        'Register a slice with the authority. The authority dynamically ' +
        'imports the declaration module to obtain the live SliceDeclaration. ' +
        'Resolves when the slice is ready to process mutations.',
    },
  },
  behaviours: {
    initialize: {
      params: initializeParamsSchema,
      description:
        'Initialize the state authority with the broadcast channel name ' +
        'and optional initial slice values. Must be called before any ' +
        'mutations are processed.',
    },
  },
  implementationLoader: async () => {
    const mod = await import('./service-implementation.js');
    return mod.StateAuthorityService;
  },
  metadata: {
    onBroker: true,
    initializer: 'initialize',
  },
  proxyFactory: (client: RuntimeClient) => {
    return (options: StateAuthorityProxyOptions): StoreBuilder =>
      createStoreBuilder(client, options.localCopy, 'state-authority');
  },
};

export default declaration;
