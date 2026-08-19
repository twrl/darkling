/**
 * The Guide's constrained-agent loop.
 *
 * An interaction begins when triggered by a flush of the event queue, as
 * defined by [Interaction triggering](../../specs/event-system.spec.md#interaction-triggering).
 * The loop receives the flushed event queue and the current status, invokes
 * the model turn by turn, dispatches tool calls in parallel, enforces the
 * budget, handles FINISHED and exhaustion, and reports the outcome.
 *
 * The loop enforces the constrained-agent discipline:
 *
 * - the model responds entirely through tool calls; free text is not
 *   permitted, as defined by [Model output](../../specs/constrained-agent.spec.md#model-output);
 * - tool calls are dispatched in parallel where possible, as defined by
 *   [Turns](../../specs/constrained-agent.spec.md#turns);
 * - the budget bounds the total cost of tool calls; when exhausted, no
 *   further calls are dispatched and the interaction ends, as defined by
 *   [Budget](../../specs/constrained-agent.spec.md#budget);
 * - undispatched tool calls are carried to the next interaction's status
 *   object, as defined by
 *   [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls);
 * - working memory updates take effect for the next interaction, as defined
 *   by [Working memory](../../specs/constrained-agent.spec.md#working-memory).
 *
 * @see specs/constrained-agent.spec.md
 */

import type {
  GuideEvent,
  InteractionInput,
  InteractionOutcome,
  ToolCall,
  ToolResult,
  TurnOutput,
  UndispatchedToolCall,
} from './model.js';
import type { BudgetPolicy, BudgetTracker, RandomSource } from './budget.js';
import { InteractionBudget } from './budget.js';
import type { LlmProvider, TurnResultEntry } from './llm-provider.js';
import type { ToolDispatchContext, ToolRegistry } from './tools.js';
import { ToolRejectedError } from './tools.js';

/**
 * Options for the agent loop.
 */
export interface AgentLoopOptions {
  /**
   * The maximum number of turns an interaction may span, as a safety bound
   * beyond the budget. The budget is the primary bound; this prevents a
   * runaway interaction when tool calls are free. Defaults to 20.
   */
  maxTurns?: number;
}

const DEFAULT_MAX_TURNS = 20;

/** A `Math.random` fallback for the overspend gate when the policy omits one. */
const DEFAULT_RANDOM: RandomSource = { next: () => Math.random() };

/**
 * The Guide's constrained-agent loop. Owns the working-memory holder and the
 * {@link BudgetTracker}; runs one interaction at a time when triggered.
 *
 * The loop is the component that runs in the Guide's dedicated Web Worker, as
 * defined by [Runtime topology](../../specs/usage-and-deployment.spec.md#runtime-topology).
 * It is worker-safe: it uses no Node.js or DOM APIs and depends only on the
 * injected {@link LlmProvider}, {@link ToolRegistry}, and {@link BudgetTracker}.
 */
export class AgentLoop {
  private readonly provider: LlmProvider;
  private readonly registry: ToolRegistry;
  private readonly budgetTracker: BudgetTracker;
  private readonly policy: BudgetPolicy;
  private readonly maxTurns: number;
  private workingMemory: unknown;
  private undispatched: UndispatchedToolCall[] = [];
  /** Undispatched calls accumulated during the current interaction's turns. */
  private pendingUndispatched: UndispatchedToolCall[] = [];

  /**
   * @param provider - the LLM provider (returns tool calls or FINISHED).
   * @param registry - the tool registry (enforces the four-category taxonomy).
   * @param budgetTracker - the budget carryover tracker.
   * @param policy - the budget policy (for max overspend and tool costs).
   * @param initialWorkingMemory - the initial working-memory value.
   * @param options - loop options.
   */
  constructor(
    provider: LlmProvider,
    registry: ToolRegistry,
    budgetTracker: BudgetTracker,
    policy: BudgetPolicy,
    initialWorkingMemory: unknown = null,
    options: AgentLoopOptions = {},
  ) {
    this.provider = provider;
    this.registry = registry;
    this.budgetTracker = budgetTracker;
    this.policy = policy;
    this.workingMemory = initialWorkingMemory;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  /** The current working memory value. */
  get currentWorkingMemory(): unknown {
    return this.workingMemory;
  }

  /** The current budget carryover (positive or negative debt) from prior interactions. */
  get currentCarryover(): number {
    return this.budgetTracker.currentCarryover;
  }

  /** The current pressure (non-negative overspend accumulator) from prior interactions. */
  get currentPressure(): number {
    return this.budgetTracker.currentPressure;
  }

  /** The undispatched tool calls carried from the previous interaction. */
  get currentUndispatched(): UndispatchedToolCall[] {
    return this.undispatched;
  }

  /**
   * Run one interaction, triggered by a flush of the event queue.
   *
   * Consumes the given events, invokes the model turn by turn, dispatches
   * tool calls in parallel, enforces the budget, and returns the outcome.
   *
   * @param events - the flushed event queue, sent to the model as part of the
   *   interaction input. Events are consumed by this interaction and must not
   *   be sent again.
   * @param host - an opaque host-provided capability bag, passed to tool
   *   handlers via the {@link ToolDispatchContext}.
   */
  async runInteraction(events: GuideEvent[], host: unknown): Promise<InteractionOutcome> {
    const budgetTotal = this.budgetTracker.budgetFor(events);
    const budget = new InteractionBudget(
      budgetTotal,
      this.policy.base,
      this.budgetTracker.currentPressure,
      this.policy.random ?? DEFAULT_RANDOM,
    );

    const carryFromPrevious = this.undispatched;
    this.undispatched = [];

    const input: InteractionInput = {
      eventQueue: events,
      status: {
        budget: {
          total: budget.budget,
          consumed: budget.consumedCost,
          remaining: budget.remaining,
        },
        workingMemory: this.workingMemory,
        undispatched: carryFromPrevious,
      },
    };

    const tools = this.registry.declarations();
    let previousResults: TurnResultEntry[] | undefined;

    let turnCount = 0;
    let finished = false;

    while (!finished && turnCount < this.maxTurns) {
      turnCount += 1;

      // Update the status object for this turn with the current budget.
      input.status.budget = {
        total: budget.budget,
        consumed: budget.consumedCost,
        remaining: budget.remaining,
      };

      let output: TurnOutput;
      try {
        output = await this.provider.turn({
          input,
          tools,
          previousResults,
        });
      } catch {
        // A provider failure ends the interaction; the response up to this
        // point stands, as required by [Exhaustion](../../specs/constrained-agent.spec.md#exhaustion).
        break;
      }

      // FINISHED ends the interaction immediately, producing no effect.
      if (output.finished || output.toolCalls === null) {
        finished = true;
        break;
      }

      // Budget exhausted: no further tool calls are dispatched, and the
      // interaction ends, as defined by [Exhaustion](../../specs/constrained-agent.spec.md#exhaustion).
      if (budget.exhausted) {
        break;
      }

      // Dispatch tool calls in parallel where possible, as defined by
      // [Turns](../../specs/constrained-agent.spec.md#turns). Keep the calls
      // alongside the results so undispatched calls retain their params.
      const { results, undispatched: turnUndispatched } = await this.dispatchTurn(
        output.toolCalls,
        budget,
        host,
      );
      this.pendingUndispatched.push(...turnUndispatched);
      previousResults = results.map(toResultEntry);

      // If the budget became exhausted during dispatch, the interaction ends
      // after this turn's dispatchable calls have been applied.
      if (budget.exhausted) {
        break;
      }
    }

    // Carry undispatched calls (rejections, budget-blocked calls) to the next
    // interaction's status object, as defined by
    // [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls).
    this.undispatched = this.pendingUndispatched;
    this.pendingUndispatched = [];

    const consumed = budget.consumedCost;
    this.budgetTracker.reportInteraction(budgetTotal, consumed);

    return {
      reason: finished ? 'finished' : 'budget-exhausted',
      consumed,
      undispatched: this.undispatched,
      workingMemory: this.workingMemory,
    };
  }

  /**
   * Dispatch a turn's tool calls in parallel, enforcing the budget. Calls
   * that would exceed the maximum permitted overspend are not dispatched and
   * become undispatched; calls that are rejected (unknown tool, prohibited
   * category, invalid params) also become undispatched, as defined by
   * [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls).
   */
  private async dispatchTurn(
    calls: ToolCall[],
    budget: InteractionBudget,
    host: unknown,
  ): Promise<{ results: ToolResult[]; undispatched: UndispatchedToolCall[] }> {
    const dispatchable: Array<{ call: ToolCall; cost: number }> = [];
    const results: ToolResult[] = [];
    const undispatched: UndispatchedToolCall[] = [];

    for (const call of calls) {
      const decl = this.registry.declaration(call.name);
      const cost = this.lookupCost(call.name, decl);
      if (budget.attemptDispatch(cost) === 'denied') {
        // The overspend gate denied the call: it becomes undispatched and
        // marks the budget exhausted, ending the interaction, as defined by
        // [Overspend](../../specs/event-system.spec.md#overspend) and
        // [Exhaustion](../../specs/constrained-agent.spec.md#exhaustion).
        results.push({
          callId: call.callId,
          name: call.name,
          ok: false,
          error: 'overspend-denied',
        });
        undispatched.push({
          name: call.name,
          params: call.params,
          reason: 'overspend-denied',
        });
        continue;
      }
      dispatchable.push({ call, cost });
    }

    // Dispatch in parallel where possible.
    const settled = await Promise.all(
      dispatchable.map(async ({ call, cost }) => {
        const context: ToolDispatchContext = {
          remainingBudget: budget.remaining - cost,
          host,
          workingMemory: {
            get: () => this.workingMemory,
            set: (v: unknown) => {
              this.workingMemory = v;
            },
          },
        };
        try {
          const value = await this.registry.dispatch(call.name, call.params, context);
          budget.consume(cost);
          const result: ToolResult = {
            callId: call.callId,
            name: call.name,
            ok: true,
            value,
            cost,
          };
          return { result, undispatched: null as UndispatchedToolCall | null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const reason = err instanceof ToolRejectedError ? err.reason : 'dispatch-failed';
          const result: ToolResult = {
            callId: call.callId,
            name: call.name,
            ok: false,
            error: `${reason}: ${message}`,
          };
          const un: UndispatchedToolCall = {
            name: call.name,
            params: call.params,
            reason: `${reason}: ${message}`,
          };
          return { result, undispatched: un };
        }
      }),
    );

    for (const s of settled) {
      results.push(s.result);
      if (s.undispatched) undispatched.push(s.undispatched);
    }
    return { results, undispatched };
  }

  /**
   * Look up the cost of a tool call. The cost comes from the policy's
   * `toolCosts` table, falling back to the tool declaration's cost, then to
   * 0, as defined by
   * [Tool call costs](../../specs/event-system.spec.md#tool-call-costs).
   */
  private lookupCost(name: string, decl: { cost: number } | undefined): number {
    const policyCost = this.policy.toolCosts[name];
    if (typeof policyCost === 'number') return policyCost;
    return decl?.cost ?? 0;
  }
}

/** Convert a {@link ToolResult} to a {@link TurnResultEntry} for the next turn. */
function toResultEntry(r: ToolResult): TurnResultEntry {
  return {
    callId: r.callId,
    name: r.name,
    ok: r.ok,
    value: r.value,
    error: r.error,
  };
}
