/**
 * Budget policy mechanics for Guide interactions.
 *
 * The budget policy is owned by [Event system](../../specs/event-system.spec.md#budget-policy):
 * each interaction's budget is composed of base + premium + carryover, where
 * the carryover is `min(spent, remaining)` from the previous interaction
 * (positive for partial spend, negative for overspend). Overspend is governed
 * by a non-negative, decaying **pressure** value and a **probabilistic
 * overspend gate** whose probability is `sigmoid(1 - (floor(pressure/2) +
 * proposed_overspend) / base)`. A failed gate roll makes the call undispatched
 * and ends the interaction via the constrained-agent exhaustion path.
 *
 * The constrained-agent spec defines the mechanism the budget enforces (no
 * further dispatch after exhaustion; the interaction ends), as defined by
 * [Budget](../../specs/constrained-agent.spec.md#budget). This module
 * implements the policy values and the carryover/pressure bookkeeping.
 *
 * @see specs/event-system.spec.md#budget-policy
 * @see specs/constrained-agent.spec.md#budget
 */

import type { GuideEvent } from './model.js';

/** A randomness source for the probabilistic overspend gate. */
export interface RandomSource {
  /** Returns a float in [0, 1). */
  next(): number;
}

/** The default randomness source: `Math.random`. */
class MathRandom implements RandomSource {
  next(): number {
    return Math.random();
  }
}

/**
 * The budget policy parameters, as defined by
 * [Budget policy](../../specs/event-system.spec.md#budget-policy). All
 * parameters must have defined values; an implementation must not leave any
 * undefined, as required by
 * [Policy parameters](../../specs/event-system.spec.md#policy-parameters).
 *
 * The probabilistic overspend gate is fully determined by the budget base and
 * the current pressure; it introduces no additional policy parameter. The
 * gate's randomness is provided by {@link BudgetPolicy.random}, which is
 * injectable so the gate is deterministic and testable, as required by
 * [Policy parameters](../../specs/event-system.spec.md#policy-parameters).
 *
 * The default policy ({@link DEFAULT_BUDGET_POLICY}) provides conservative
 * defaults; the host overrides them via configuration, per
 * [Policy and configuration](../../specs/policy-and-configuration.spec.md).
 */
export interface BudgetPolicy {
  /** The fixed budget amount assigned to every interaction; also the denominator of the probabilistic overspend gate. */
  base: number;
  /**
   * The function determining the premium based on the event types in the
   * flushed queue, reflecting the expected cost of responding to those events.
   * Event types that are expected to require more Guide effort (e.g. a direct
   * address) carry a higher premium than routine events.
   */
  premium: (eventTypes: string[]) => number;
  /**
   * The costs assigned to tool call types, keyed by tool name. The cost of
   * each tool is included in the tool's definition sent to the model, as
   * required by [Tool call costs](../../specs/event-system.spec.md#tool-call-costs).
   * A missing entry defaults to 0.
   */
  toolCosts: Record<string, number>;
  /**
   * A randomness source for the probabilistic overspend gate. Defaults to
   * `Math.random`. Inject a deterministic source for testing.
   */
  random?: RandomSource;
}

/**
 * The default budget policy. Conservative placeholder values; the host should
 * override via configuration. The premium function gives a small premium per
 * event, with a larger premium for `direct_address` events (which always
 * trigger a flush and expect a response), as described by
 * [Budget composition](../../specs/event-system.spec.md#budget-composition).
 */
export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  base: 10,
  premium: (eventTypes) =>
    eventTypes.reduce((sum, type) => sum + (type === 'direct_address' ? 4 : 1), 0),
  toolCosts: {},
  random: new MathRandom(),
};

/**
 * The logistic sigmoid, $\sigma(x) = 1 / (1 + e^{-x})$, used by the probabilistic
 * overspend gate, as defined by [Overspend](../../specs/event-system.spec.md#overspend).
 */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * The probability that a proposed overspend is permitted, as defined by
 * [Overspend](../../specs/event-system.spec.md#overspend):
 *
 * $$\text{probability\_allowed} = \sigma\!\left(1 - \frac{\lfloor p/2 \rfloor + o}{b}\right)$$
 *
 * where $p$ is the current pressure, $o$ the proposed overspend, and $b$ the
 * budget base. The numerator is the pressure that would result if the overspend
 * were permitted (the pressure decay step applied to the current pressure,
 * plus the overspend amount), scaled against the base.
 *
 * @param pressure - the current pressure (non-negative).
 * @param proposedOverspend - the amount by which the call would exceed the
 *   remaining budget (non-negative).
 * @param base - the budget base policy parameter (positive).
 */
export function overspendProbability(
  pressure: number,
  proposedOverspend: number,
  base: number,
): number {
  const prospectivePressure = Math.floor(pressure / 2) + proposedOverspend;
  return sigmoid(1 - prospectivePressure / base);
}

/**
 * Tracks carryover and pressure across interactions, as defined by
 * [Carryover](../../specs/event-system.spec.md#carryover) and
 * [Pressure](../../specs/event-system.spec.md#pressure).
 *
 * One tracker is shared across the Guide's lifetime. After each interaction,
 * the host reports the budget and cost consumed; the tracker computes the
 * carryover (`min(spent, remaining)`) and updates pressure
 * (`max(0, floor(p/2) - min(0, remaining))`).
 */
export class BudgetTracker {
  private carryover = 0;
  private pressure = 0;
  private readonly policy: BudgetPolicy;

  constructor(policy: BudgetPolicy = DEFAULT_BUDGET_POLICY) {
    this.policy = policy;
  }

  /** The current carryover (positive for partial spend, negative for overspend debt). */
  get currentCarryover(): number {
    return this.carryover;
  }

  /** The current pressure (non-negative, decaying overspend accumulator). */
  get currentPressure(): number {
    return this.pressure;
  }

  /**
   * Compute the budget for an interaction, given the events in the flushed
   * queue. The budget is `base + premium + carryover`, as defined by
   * [Budget composition](../../specs/event-system.spec.md#budget-composition).
   */
  budgetFor(events: GuideEvent[]): number {
    const eventTypes = events.map((e) => e.type);
    return this.policy.base + this.policy.premium(eventTypes) + this.carryover;
  }

  /**
   * Report the outcome of an interaction, updating the carryover and pressure.
   *
   * The carryover is `min(spent, remaining)`, where `remaining = budget -
   * spent`; it peaks at half-budget and is zero both when the Guide declines to
   * act and at full spend, and negative on overspend, as defined by
   * [Carryover](../../specs/event-system.spec.md#carryover).
   *
   * Pressure is updated as `max(0, floor(p/2) - min(0, remaining))`: halved on
   * frugal/at-budget interactions, grown by the overspend amount on overspent
   * interactions, clamped to be non-negative, as defined by
   * [Pressure](../../specs/event-system.spec.md#pressure).
   *
   * @param budget - the budget for the interaction.
   * @param consumed - the cumulative cost consumed during the interaction.
   */
  reportInteraction(budget: number, consumed: number): void {
    const remaining = budget - consumed;
    // Carryover: min(spent, remaining).
    this.carryover = Math.min(consumed, remaining);
    // Pressure: halve, then subtract min(0, remaining) (which is 0 when
    // frugal/on-budget, or the negative overspend amount when overspent).
    this.pressure = Math.max(0, Math.floor(this.pressure / 2) - Math.min(0, remaining));
  }
}

/** The result of attempting to dispatch a tool call against the budget. */
export type DispatchAttempt = 'ok' | 'denied';

/**
 * The budget state for an in-progress interaction, tracking consumption and
 * enforcing the cost-based bound, as defined by
 * [Cost model](../../specs/constrained-agent.spec.md#cost-model) and
 * [Exhaustion](../../specs/constrained-agent.spec.md#exhaustion).
 *
 * The budget is consumed cumulatively by the cost of each tool call dispatched
 * across all turns. Turns are not counted toward the budget; only tool call
 * costs are. A tool call that would exceed the budget is subject to the
 * probabilistic overspend gate, as defined by
 * [Overspend](../../specs/event-system.spec.md#overspend): if the gate roll
 * succeeds the call is dispatched and its cost consumed; if the roll fails the
 * call is denied, becomes undispatched, and ends the interaction via
 * exhaustion.
 *
 * Because the gate is a soft bound, there is no fixed maximum permitted
 * overspend amount. Exhaustion is reached when a dispatch is denied (a gate
 * roll failed), at which point no further tool calls are dispatched and the
 * interaction must end.
 */
export class InteractionBudget {
  private consumed = 0;
  private denied = false;
  private readonly total: number;
  private readonly base: number;
  private readonly pressure: number;
  private readonly random: RandomSource;

  /**
   * @param total - the total budget for this interaction (base + premium + carryover).
   * @param base - the budget base policy parameter (the gate's denominator).
   * @param pressure - the current pressure at the start of the interaction.
   * @param random - the randomness source for the gate.
   */
  constructor(total: number, base: number, pressure: number, random: RandomSource) {
    this.total = total;
    this.base = base;
    this.pressure = pressure;
    this.random = random;
  }

  /** The total budget for the interaction. */
  get budget(): number {
    return this.total;
  }

  /** The cumulative cost consumed so far. */
  get consumedCost(): number {
    return this.consumed;
  }

  /** The remaining budget (`total - consumed`). May be negative under overspend. */
  get remaining(): number {
    return this.total - this.consumed;
  }

  /**
   * Whether a dispatch was denied by the overspend gate this interaction. When
   * denied, no further tool calls may be dispatched and the interaction must
   * end, as defined by [Exhaustion](../../specs/constrained-agent.spec.md#exhaustion).
   */
  get exhausted(): boolean {
    return this.denied;
  }

  /**
   * Attempt to dispatch a tool call of the given cost. A call that fits within
   * the remaining budget is always permitted. A call that would exceed the
   * budget (an overspend) is subject to the probabilistic overspend gate, as
   * defined by [Overspend](../../specs/event-system.spec.md#overspend): if the
   * roll succeeds the call is permitted (`'ok'`); if it fails the call is
   * denied (`'denied'`), marking the budget exhausted.
   *
   * @returns `'ok'` if the call may be dispatched (and its cost should be
   *   recorded via {@link consume}); `'denied'` if the gate rejected the call.
   */
  attemptDispatch(cost: number): DispatchAttempt {
    if (this.denied) return 'denied';
    if (cost <= this.remaining) return 'ok';
    // Overspend: roll the probabilistic gate.
    const proposedOverspend = cost - this.remaining;
    const probability = overspendProbability(this.pressure, proposedOverspend, this.base);
    if (this.random.next() < probability) return 'ok';
    this.denied = true;
    return 'denied';
  }

  /**
   * Record the cost of a dispatched tool call. Callers must only call this
   * after {@link attemptDispatch} returned `'ok'` for the same cost.
   */
  consume(cost: number): void {
    this.consumed += cost;
  }
}
