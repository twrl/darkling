/**
 * Core model types for the Guide's constrained-agent loop.
 *
 * Defines the interaction input, status object, tool call representation, and
 * the FINISHED control signal, as defined by
 * [Constrained agent](../../specs/constrained-agent.spec.md).
 *
 * @see specs/constrained-agent.spec.md
 */

/**
 * A high-level semantic event produced by the UI, as defined by
 * [Constrained agent](../../specs/constrained-agent.spec.md#events).
 *
 * The event structure (type, timestamp, payload) is owned by the event system
 * spec. The Guide's agent loop consumes events as part of the interaction
 * input; it treats the payload as opaque. The specific event types and their
 * payloads are defined by the UI specification.
 */
export interface GuideEvent {
  /** The event type, from the controlled vocabulary established by the UI spec. */
  type: string;
  /** The time at which the event occurred. */
  timestamp: number;
  /** Event-type-specific data describing the event. */
  payload: unknown;
}

/**
 * A tool call issued by the model in a turn.
 *
 * The Guide responds entirely through tool calls; free text is not permitted,
 * as defined by [Model output](../../specs/constrained-agent.spec.md#model-output).
 * A tool call identifies the tool by name and carries an arbitrary JSON
 * parameter object. The parameter is validated against the tool's Zod schema
 * by the {@link ToolRegistry} before dispatch.
 */
export interface ToolCall {
  /** The name of the tool to invoke. Must be a registered tool. */
  name: string;
  /** The tool's parameters, validated against the tool's parameter schema. */
  params: unknown;
  /**
   * An opaque caller-assigned id used to correlate a tool call with its result
   * across a turn. The model (or the loop) assigns this; the loop uses it to
   * match {@link ToolResult}s to {@link ToolCall}s.
   */
  callId: string;
}

/**
 * The result of dispatching a {@link ToolCall}.
 *
 * On success, `ok` is true and `value` carries the tool's return value. On
 * failure, `ok` is false and `error` carries a description of why the call
 * could not be dispatched or failed. Failed calls become undispatched tool
 * calls, as defined by
 * [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls).
 */
export interface ToolResult {
  /** The call id of the {@link ToolCall} this result corresponds to. */
  callId: string;
  /** The name of the tool that was called. */
  name: string;
  /** Whether the call was dispatched successfully. */
  ok: boolean;
  /** The tool's return value, when `ok` is true. */
  value?: unknown;
  /** A description of why the call failed, when `ok` is false. */
  error?: string;
  /**
   * The cost consumed by this call, when `ok` is true. Failed calls consume no
   * budget, as defined by [Budget](../../specs/constrained-agent.spec.md#budget):
   * only dispatched tool calls consume cost.
   */
  cost?: number;
}

/**
 * A tool call from the immediately previous interaction that could not be
 * dispatched, surfaced to the model in the next interaction's status object.
 *
 * As defined by
 * [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls),
 * the model may reissue or discard them; discarding produces no error.
 */
export interface UndispatchedToolCall {
  /** The tool name. */
  name: string;
  /** The tool parameters. */
  params: unknown;
  /** Why the call could not be dispatched. */
  reason: string;
}

/**
 * The budget for an interaction, included in the status object sent to the
 * model, as defined by
 * [Budget status](../../specs/constrained-agent.spec.md#budget-status).
 *
 * The Guide must be able to observe the remaining budget to inform its
 * decisions. The budget is cost-based and consumed cumulatively by the cost of
 * each tool call dispatched across all turns within the interaction, as
 * defined by [Cost model](../../specs/constrained-agent.spec.md#cost-model).
 */
export interface BudgetStatus {
  /** The total budget for this interaction (base + premium + carryover). */
  total: number;
  /** The cumulative cost consumed so far this interaction. */
  consumed: number;
  /** The remaining budget (`total - consumed`). */
  remaining: number;
}

/**
 * The status object sent to the model as part of the interaction input, as
 * defined by
 * [Interaction input](../../specs/constrained-agent.spec.md#interaction-input).
 *
 * Must include the budget, working memory, and undispatched tool calls. May
 * include additional fields by implementation.
 */
export interface InteractionStatus {
  /** The budget for this interaction. */
  budget: BudgetStatus;
  /**
   * The Guide's working memory: an arbitrary JSON value persisted across
   * interactions, as defined by
   * [Working memory](../../specs/constrained-agent.spec.md#working-memory).
   */
  workingMemory: unknown;
  /**
   * Undispatched tool calls from the immediately previous interaction. Empty
   * for the first interaction or when the previous interaction had none.
   */
  undispatched: UndispatchedToolCall[];
}

/**
 * The input to a Guide interaction: the event queue and the status object.
 *
 * As defined by
 * [Interaction input](../../specs/constrained-agent.spec.md#interaction-input):
 * when an interaction is triggered, the model receives the event queue (the
 * accumulated events not yet consumed) and a status object describing the
 * current state.
 */
export interface InteractionInput {
  /** The accumulated events that have not yet been consumed by an interaction. */
  eventQueue: GuideEvent[];
  /** The status object describing the current state and the Guide's context. */
  status: InteractionStatus;
}

/**
 * The outcome of a completed interaction, reported to the host.
 *
 * An interaction ends when the model returns FINISHED or the budget is
 * exhausted, as defined by [Budget](../../specs/constrained-agent.spec.md#budget)
 * and [FINISHED](../../specs/constrained-agent.spec.md#finished).
 */
export interface InteractionOutcome {
  /** The reason the interaction ended. */
  reason: 'finished' | 'budget-exhausted';
  /** The cumulative cost consumed during the interaction. */
  consumed: number;
  /** Any tool calls that could not be dispatched, to carry to the next interaction. */
  undispatched: UndispatchedToolCall[];
  /** The working memory at the end of the interaction. */
  workingMemory: unknown;
}

/**
 * The control signal that ends an interaction, as defined by
 * [FINISHED](../../specs/constrained-agent.spec.md#finished).
 *
 * FINISHED is an abstraction over the underlying model provider's completion
 * signal (e.g. OpenAI's `finish_reason: "stop"`). It is not a tool call and
 * produces no effect; it signals that the model has completed its output for a
 * turn without issuing further tool calls.
 */
export const FINISHED = 'FINISHED' as const;

/**
 * A turn is one inference cycle within an interaction, as defined by
 * [Turns](../../specs/constrained-agent.spec.md#turns). The model is invoked
 * with the interaction input (first turn) or the previous turn's tool results
 * (subsequent turns), and produces tool calls or FINISHED.
 */
export interface TurnOutput {
  /**
   * The tool calls issued by the model in this turn, or `null` when the model
   * returned FINISHED.
   */
  toolCalls: ToolCall[] | null;
  /** True when the model returned FINISHED, ending the interaction. */
  finished: boolean;
}
