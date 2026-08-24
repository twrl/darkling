/**
 * The Guide agent service declaration — exposes the agent loop as a service
 * on the bus, as defined by [Service registration](../../specs/service-bus.spec.md#service-registration).
 *
 * The Guide agent loop runs in a dedicated Web Worker, as defined by
 * [Runtime topology](../../specs/usage-and-deployment.spec.md#runtime-topology).
 * Running it as a bus service lets the host (the frontend main thread) trigger
 * interactions over the bus and receive outcomes, while the loop is isolated
 * from the main thread.
 *
 * @see specs/service-bus.spec.md#service-registration
 * @see specs/constrained-agent.spec.md
 */

import { z } from 'zod';
import type { ServiceDeclaration } from '@darkling/service-bus';

// --- Zod schemas for the agent service functions ---

const eventSchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  payload: z.unknown(),
});

const interactionOutcomeSchema = z.object({
  reason: z.enum(['finished', 'budget-exhausted']),
  consumed: z.number(),
  undispatched: z.array(
    z.object({
      name: z.string(),
      params: z.unknown(),
      reason: z.string(),
    }),
  ),
  workingMemory: z.unknown(),
});

/**
 * The service declaration for the Guide agent. Exposes `runInteraction` as a
 * service function: the host calls it with the flushed event queue and
 * receives the interaction outcome.
 *
 * The `implementationLoader` dynamically imports the implementation module,
 * returning the `GuideService` constructor. The host instantiates the class
 * with a `HostContext`, injecting the LLM provider, tool registry, and budget
 * policy via {@link GuideServiceOptions}.
 */
export const declaration: ServiceDeclaration = {
  id: 'guide',
  functions: {
    runInteraction: {
      params: z.object({ events: z.array(eventSchema) }),
      returns: interactionOutcomeSchema,
      description:
        'Run one Guide interaction over the given flushed event queue. ' +
        'Returns the outcome: the end reason, cumulative cost consumed, ' +
        'undispatched tool calls, and working memory.',
    },
  },
  implementationLoader: async () => {
    const mod = await import('./service-implementation.js');
    return mod.GuideService;
  },
};

export default declaration;

export type { GuideServiceDeclaration } from './service-implementation.js';
