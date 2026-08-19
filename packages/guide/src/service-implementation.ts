/**
 * The Guide agent service implementation. Owns an {@link AgentLoop} and
 * dispatches `runInteraction` calls to it.
 *
 * This module is loaded lazily by the service declaration's
 * `implementationLoader`, so that the implementation is kept out of the
 * initial bundle and loaded on demand by the host worker.
 *
 * @see specs/service-bus.spec.md#service-interface-contract
 */

import type { HostContext, ServiceCallContext, ServiceDeclaration } from '@darkling/service-bus';
import { ServiceImplementation } from '@darkling/service-bus';

import { AgentLoop, type AgentLoopOptions } from './agent-loop.js';
import { BudgetTracker, DEFAULT_BUDGET_POLICY, type BudgetPolicy } from './budget.js';
import type { LlmProvider } from './llm-provider.js';
import type { ToolRegistry } from './tools.js';
import type { GuideEvent, InteractionOutcome } from './model.js';

/**
 * Options for the Guide service, carried by the `HostContext`. Allows the
 * host to inject the LLM provider, tool registry, budget policy, and initial
 * working memory.
 */
export interface GuideServiceOptions {
  /** The LLM provider (returns tool calls or FINISHED). */
  provider: LlmProvider;
  /** The tool registry (enforces the four-category taxonomy). */
  registry: ToolRegistry;
  /** The budget policy. Defaults to {@link DEFAULT_BUDGET_POLICY}. */
  budgetPolicy?: BudgetPolicy;
  /** The initial working-memory value. Defaults to null. */
  initialWorkingMemory?: unknown;
  /** Loop options. */
  loopOptions?: AgentLoopOptions;
}

/**
 * The Guide service's function names, used to type the
 * `ServiceImplementation` generic parameter.
 */
export type GuideServiceDeclaration = ServiceDeclaration & {
  functions: {
    runInteraction: unknown;
  };
};

/**
 * The Guide agent service implementation. Owns an {@link AgentLoop} and
 * dispatches `runInteraction` calls to it.
 */
export class GuideService extends ServiceImplementation<GuideServiceDeclaration> {
  private readonly loop: AgentLoop;

  constructor(hostContext: HostContext) {
    super(hostContext);
    const options = (hostContext as HostContext & { guide?: GuideServiceOptions }).guide;
    if (!options) {
      throw new Error('GuideService requires a GuideServiceOptions under hostContext.guide');
    }
    this.loop = new AgentLoop(
      options.provider,
      options.registry,
      new BudgetTracker(options.budgetPolicy ?? DEFAULT_BUDGET_POLICY),
      options.budgetPolicy ?? DEFAULT_BUDGET_POLICY,
      options.initialWorkingMemory,
      options.loopOptions,
    );
  }

  async invoke(
    functionName: string,
    params: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ServiceCallContext,
  ): Promise<unknown> {
    if (functionName !== 'runInteraction') {
      throw new Error(`Unknown function: ${functionName}`);
    }
    const p = params as { events: GuideEvent[] };
    const outcome: InteractionOutcome = await this.loop.runInteraction(p.events, undefined);
    return outcome;
  }
}
