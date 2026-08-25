/**
 * The frontend Guide agent service declaration — exposes the Guide's
 * `runInteraction` as a service on the bus, as defined by
 * [Service registration](../../specs/service-bus.spec.md#service-registration).
 *
 * Unlike the knowledge-base service (whose declaration is re-exported
 * verbatim), the frontend Guide service is a frontend-specific implementation:
 * it builds the loop's non-serialisable dependencies (the `HttpLlmProvider`,
 * `ToolRegistry`, and `BudgetTracker`) from serialisable config carried
 * across the worker boundary. This declaration's `implementationLoader`
 * therefore dynamically imports `./guide-service.ts` (returning
 * `FrontendGuideService`), not `@darkling/guide`'s `GuideService`. The wire
 * contract (the `runInteraction` parameter and return schemas) mirrors
 * `@darkling/guide`'s declaration so callers and the broker validate
 * identically.
 *
 * @see specs/service-bus.spec.md#service-registration
 * @see specs/constrained-agent.spec.md
 */

import { z } from 'zod';
import type { ServiceDeclaration } from '@darkling/service-bus';

// --- Zod schemas for the agent service functions ---
// These mirror @darkling/guide's service-declaration.ts so the wire contract
// is identical. Duplicated rather than imported to keep the declaration module
// free of the implementation dependency (the declaration module must not
// import the implementation at module-load time, per the service-bus spec).

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
 * The service declaration for the frontend Guide agent. Exposes
 * `runInteraction` as a service function: the host calls it with the flushed
 * event queue and receives the interaction outcome.
 *
 * The `implementationLoader` dynamically imports the frontend implementation
 * module, returning the `FrontendGuideService` constructor. The host worker
 * instantiates the class with a `HostContext` whose `options.guide` carries
 * the serialisable construction config (the LLM endpoint, budget policy, and
 * initial working memory); the worker builds the provider/registry from it.
 */
export const declaration = {
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
    const mod = await import('./guide-service.js');
    return mod.FrontendGuideService;
  },
} as const satisfies ServiceDeclaration;

/** The concrete declaration type, for typed proxy creation on the main thread. */
export type FrontendGuideServiceDeclaration = typeof declaration;

export default declaration;
