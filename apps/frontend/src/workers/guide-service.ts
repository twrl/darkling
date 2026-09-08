/**
 * The frontend's Guide agent service: a service-bus implementation that owns a
 * {@link GuideService} (and through it an {@link AgentLoop}) running inside the
 * Guide's dedicated worker, as defined by
 * [Runtime](../../specs/runtime.spec.md#worker-topology).
 *
 * The Guide worker builds the loop's non-serialisable dependencies — the
 * {@link HttpLlmProvider}, the {@link ToolRegistry}, and the
 * {@link BudgetTracker} — from serialisable config carried across the worker
 * boundary via the service registration's `options.guide` bag (see the
 * service-bus worker-protocol extension). Out of testing, the Guide always
 * uses {@link HttpLlmProvider}, so the provider is constructed here from the
 * LLM proxy endpoint URL.
 *
 * The tool registry is seeded with the agent-self tools defined by
 * `@darkling/guide` (`update_working_memory`). The other three categories
 * (avatar-and-user-interaction, ui-control, knowledge-base-access) are
 * registered by the host on the main thread and proxied to via the bus; that
 * wiring is a follow-up (see the frontend journal). The `safety_consult`
 * agent-self tool is also deferred: it requires a host-injected
 * {@link SafetyConsultant} (a separate LLM agent exposed as a bus service,
 * per [Agent safety](../../specs/agent-safety.spec.md#the-safety-consultant)),
 * which is not yet implemented.
 *
 * @see specs/constrained-agent.spec.md
 * @see specs/usage-and-deployment.spec.md#llm-provider-abstraction
 * @see packages/guide/package.spec.md
 */

import type { HostContext, ServiceCallContext, ServiceDeclaration } from '@darkling/service-bus';
import { ServiceImplementation } from '@darkling/service-bus';

import {
  DEFAULT_BUDGET_POLICY,
  HttpLlmProvider,
  ToolRegistry,
  createUpdateWorkingMemoryHandler,
  updateWorkingMemoryDeclaration,
  GuideService,
  type BudgetPolicy,
  type GuideServiceOptions,
} from '@darkling/guide';

/**
 * The serialisable construction options the frontend hands to the Guide
 * worker via the service registration's `options.guide` bag. The worker
 * builds the non-serialisable dependencies from these.
 */
export interface FrontendGuideOptions {
  /** The backend LLM proxy endpoint URL (e.g. `/llm/turn`). */
  llmEndpoint: string;
  /**
   * The budget policy. The `premium` map and `toolCosts` are serialisable; the
   * optional `random` is omitted in production (the loop defaults to
   * `Math.random`).
   */
  budgetPolicy?: BudgetPolicy;
  /** The initial working-memory value. Defaults to null. */
  initialWorkingMemory?: unknown;
  /** The maximum number of turns an interaction may span. Defaults to 20. */
  maxTurns?: number;
}

/**
 * Read the serialisable frontend guide options from the host context, either
 * via the worker-protocol `options` bag (keyed by service ID) or the
 * in-process top-level form.
 */
export function readOptions(hostContext: HostContext): FrontendGuideOptions {
  const opts =
    (hostContext.options?.guide as FrontendGuideOptions | undefined) ??
    (hostContext as HostContext & { guide?: FrontendGuideOptions }).guide;
  if (!opts || !opts.llmEndpoint) {
    throw new Error('FrontendGuideService requires options.guide.llmEndpoint');
  }
  return opts;
}

/**
 * Build the Guide service options (provider, registry, budget policy) from
 * the serialisable frontend options, inside the worker.
 */
export function buildGuideServiceOptions(opts: FrontendGuideOptions): GuideServiceOptions {
  const provider = new HttpLlmProvider({ endpoint: opts.llmEndpoint });
  const registry = new ToolRegistry();
  // Agent-self tools defined by @darkling/guide. The loop owns working memory,
  // accessed via the dispatch context, so the handler takes no arguments.
  registry.register(updateWorkingMemoryDeclaration, createUpdateWorkingMemoryHandler());
  // safety_consult is deferred: it needs a host-injected SafetyConsultant
  // (a bus service to a backend consultant), which is not yet implemented.
  const budgetPolicy: BudgetPolicy = opts.budgetPolicy ?? DEFAULT_BUDGET_POLICY;
  return {
    provider,
    registry,
    budgetPolicy,
    initialWorkingMemory: opts.initialWorkingMemory ?? null,
    loopOptions: opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : undefined,
  };
}

/**
 * The frontend Guide service's function names, used to type the
 * `ServiceImplementation` generic parameter. Mirrors `@darkling/guide`'s
 * `GuideServiceDeclaration`.
 */
export type FrontendGuideDeclaration = ServiceDeclaration & {
  functions: {
    runInteraction: unknown;
  };
};

/**
 * The frontend Guide agent service implementation. Constructs an
 * {@link AgentLoop} from serialisable config (the LLM endpoint, budget policy,
 * and initial working memory) carried across the worker boundary, and
 * dispatches `runInteraction` calls to it.
 *
 * The loop itself is owned by `@darkling/guide`'s {@link GuideService}; this
 * class is a thin frontend wrapper that builds the `GuideServiceOptions` from
 * serialisable config and delegates to `GuideService`. Keeping the
 * provider/registry construction in the frontend (not in `@darkling/guide`)
 * preserves the guide package's provider-agnostic contract, as its package
 * spec requires.
 */
export class FrontendGuideService extends ServiceImplementation<FrontendGuideDeclaration> {
  private readonly delegate: GuideService;

  constructor(hostContext: HostContext) {
    super(hostContext);
    const options = buildGuideServiceOptions(readOptions(hostContext));
    // Construct the delegate with the built options. GuideService reads
    // options from hostContext.options?.guide; mirror that shape so the
    // delegate finds them.
    const delegateContext: HostContext = {
      serviceClient: hostContext.serviceClient,
      options: { ...hostContext.options, guide: options },
    };
    this.delegate = new GuideService(delegateContext);
  }

  async invoke(
    functionName: string,
    params: unknown,
    context: ServiceCallContext,
  ): Promise<unknown> {
    return this.delegate.invoke(functionName, params, context);
  }
}
