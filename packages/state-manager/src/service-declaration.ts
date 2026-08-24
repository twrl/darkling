/**
 * The state manager service declaration — exposes the authority as a service
 * on the bus, as defined by [Service registration](../../specs/service-bus.spec.md#service-registration).
 *
 * The authority runs in a dedicated Web Worker, consistent with the worker
 * topology established by [Usage and deployment](../../specs/usage-and-deployment.spec.md).
 * Running it as a bus service lets any thread (UI, Guide, services) propose
 * updates and fetch snapshots over the bus, while accepted patches broadcast
 * over a peer `BroadcastChannel`.
 *
 * @see specs/state-manager.spec.md#authority
 */

import { z } from 'zod';
import type { ServiceDeclaration } from '@darkling/service-bus';

// --- Zod schemas for the authority service functions ---

const patchSchema = z.object({
  op: z.enum(['replace', 'remove', 'add']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});

const proposalSchema = z.object({
  slice: z.string(),
  patch: z.array(patchSchema),
  basisSeq: z.number().int().nonnegative(),
  source: z.enum(['ui', 'guide', 'service']),
});

const ackSchema = z.object({ seq: z.number().int().nonnegative() });

const snapshotRequestSchema = z.object({ slice: z.string() });

const snapshotSchema = z.object({
  value: z.unknown(),
  seq: z.number().int().nonnegative(),
});

/**
 * The service declaration for the state manager authority. Exposes:
 * - `proposeUpdate` — submit a proposed update for validation and, if
 *   accepted, broadcast. Resolves with an acknowledgement on acceptance,
 *   rejects with a `ServiceBusError` on rejection.
 * - `getSnapshot` — return the current authoritative value of a slice
 *   together with its current sequence number.
 *
 * The `implementationLoader` dynamically imports the implementation module,
 * returning the `StateManagerService` constructor. The host instantiates the
 * class with a `HostContext`, injecting the slice registry and broadcast
 * channel options via {@link StateManagerServiceOptions}.
 *
 * @see specs/state-manager.spec.md#authority
 */
export const declaration: ServiceDeclaration = {
  id: 'state-manager',
  functions: {
    proposeUpdate: {
      params: proposalSchema,
      returns: ackSchema,
      description:
        'Submit a proposed update to a shared-state slice. The authority ' +
        'validates the proposal against the slice schema and invariants, ' +
        'and on acceptance broadcasts the patch over the BroadcastChannel. ' +
        'Resolves with an ack carrying the assigned sequence number; ' +
        'rejects with a ServiceBusError (StaleBasisError, ValidationError, ' +
        'or StateInvariantError) on rejection.',
    },
    getSnapshot: {
      params: snapshotRequestSchema,
      returns: snapshotSchema,
      description:
        'Return the current authoritative value of a slice together with ' +
        'its current sequence number. Used for initialisation and gap ' +
        'recovery by local copies.',
    },
  },
  implementationLoader: async () => {
    const mod = await import('./service-implementation.js');
    return mod.StateManagerService;
  },
};

export default declaration;
