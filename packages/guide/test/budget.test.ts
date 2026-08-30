/**
 * Tests for the revised budget policy: `min(spent, remaining)` carryover,
 * non-negative decaying pressure, and the probabilistic overspend gate.
 *
 * @see specs/constrained-agent.spec.md#budget
 */

import { describe, it, expect } from 'vitest';

import {
  BudgetTracker,
  DEFAULT_BUDGET_POLICY,
  InteractionBudget,
  overspendProbability,
  sigmoid,
  type BudgetPolicy,
  type RandomSource,
} from '../src/budget.js';
import { event } from './fixtures.js';

function policy(overrides: Partial<BudgetPolicy> = {}): BudgetPolicy {
  return { ...DEFAULT_BUDGET_POLICY, ...overrides };
}

/** A deterministic randomness source with a fixed sequence of rolls. */
class scriptedRandom implements RandomSource {
  private rolls: number[];
  private cursor = 0;
  constructor(rolls: number[]) {
    this.rolls = rolls;
  }
  next(): number {
    return this.rolls[this.cursor++] ?? this.rolls[this.rolls.length - 1] ?? 0;
  }
}

describe('sigmoid', () => {
  it('is 0.5 at 0 and monotonic', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 6);
    expect(sigmoid(1)).toBeGreaterThan(0.5);
    expect(sigmoid(-1)).toBeLessThan(0.5);
  });
});

describe('overspendProbability', () => {
  it('matches the spec formula: sigmoid(1 - (floor(p/2) + o) / base)', () => {
    const p = 4;
    const o = 2;
    const base = 10;
    const expected = sigmoid(1 - (Math.floor(4 / 2) + 2) / 10); // sigmoid(1 - 4/10)
    expect(overspendProbability(p, o, base)).toBeCloseTo(expected, 6);
  });

  it('decreases as pressure rises', () => {
    const base = 10;
    const o = 1;
    const low = overspendProbability(0, o, base);
    const high = overspendProbability(20, o, base);
    expect(high).toBeLessThan(low);
  });

  it('decreases as the proposed overspend rises', () => {
    const base = 10;
    const p = 0;
    const small = overspendProbability(p, 1, base);
    const large = overspendProbability(p, 20, base);
    expect(large).toBeLessThan(small);
  });

  it('is never exactly 0 (pressure unbounded but soft)', () => {
    expect(overspendProbability(1000, 1000, 10)).toBeGreaterThan(0);
  });

  it('is never exactly 1', () => {
    expect(overspendProbability(0, 0, 10)).toBeLessThan(1);
  });
});

describe('BudgetTracker — composition', () => {
  it('computes budget as base + premium + carryover', () => {
    const p = policy({ base: 10, premium: { a: 2, b: 2 } });
    const tracker = new BudgetTracker(p);
    expect(tracker.budgetFor([event('a'), event('b')])).toBe(14); // 10 + 4 + 0
  });

  it('treats unknown event types as zero premium', () => {
    const p = policy({ base: 10, premium: { direct_address: 4 } });
    const tracker = new BudgetTracker(p);
    expect(tracker.budgetFor([event('scroll'), event('scroll')])).toBe(10); // 10 + 0 + 0
  });
});

describe('BudgetTracker — carryover (min(spent, remaining))', () => {
  it('peaks at half-budget spend', () => {
    const p = policy({ base: 10, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(10, 5); // spent 5, remaining 5 -> min(5,5)=5
    expect(tracker.currentCarryover).toBe(5);
  });

  it('is zero when the Guide declines to act', () => {
    const p = policy({ base: 10, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(10, 0); // spent 0, remaining 10 -> min(0,10)=0
    expect(tracker.currentCarryover).toBe(0);
  });

  it('is zero at full spend', () => {
    const p = policy({ base: 10, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(10, 10); // spent 10, remaining 0 -> min(10,0)=0
    expect(tracker.currentCarryover).toBe(0);
  });

  it('is negative on overspend (debt carried forward)', () => {
    const p = policy({ base: 5, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(5, 7); // spent 7, remaining -2 -> min(7,-2)=-2
    expect(tracker.currentCarryover).toBe(-2);
  });
});

describe('BudgetTracker — pressure', () => {
  it('is zero initially and stays zero on frugal spend', () => {
    const p = policy({ base: 10, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(10, 4); // remaining 6 >= 0 -> halve 0 -> 0
    expect(tracker.currentPressure).toBe(0);
  });

  it('grows by the overspend amount (after halving) on overspend', () => {
    const p = policy({ base: 5, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(5, 7); // remaining -2 -> floor(0/2) + 2 = 2
    expect(tracker.currentPressure).toBe(2);
  });

  it('halves on a frugal interaction following an overspend', () => {
    const p = policy({ base: 5, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(5, 7); // pressure 2
    expect(tracker.currentPressure).toBe(2);
    tracker.reportInteraction(5, 2); // remaining 3 >= 0 -> floor(2/2) = 1
    expect(tracker.currentPressure).toBe(1);
  });

  it('is non-negative (frugal after zero pressure stays zero)', () => {
    const p = policy({ base: 10, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(10, 3); // floor(0/2)=0
    expect(tracker.currentPressure).toBe(0);
  });

  it('accumulates across repeated overspends', () => {
    const p = policy({ base: 5, premium: {} });
    const tracker = new BudgetTracker(p);
    tracker.reportInteraction(5, 7); // pressure 2
    tracker.reportInteraction(5, 7); // floor(2/2)=1 + 2 = 3
    expect(tracker.currentPressure).toBe(3);
  });
});

describe('InteractionBudget — within-budget dispatch', () => {
  it('always permits a call that fits within the remaining budget', () => {
    const b = new InteractionBudget(10, 10, 0, new scriptedRandom([]));
    expect(b.attemptDispatch(4)).toBe('ok');
    expect(b.remaining).toBe(10);
    b.consume(4);
    expect(b.remaining).toBe(6);
    expect(b.exhausted).toBe(false);
  });

  it('permits a call that exactly exhausts the budget', () => {
    const b = new InteractionBudget(10, 10, 0, new scriptedRandom([]));
    expect(b.attemptDispatch(10)).toBe('ok');
    expect(b.exhausted).toBe(false);
  });
});

describe('InteractionBudget — overspend gate', () => {
  it('permits an overspend when the gate roll succeeds', () => {
    // probability for pressure 0, overspend 2, base 10 is sigmoid(1 - 2/10)
    // ≈ 0.665. A roll of 0.0 < 0.665 succeeds.
    const b = new InteractionBudget(10, 10, 0, new scriptedRandom([0.0]));
    expect(b.attemptDispatch(12)).toBe('ok');
    b.consume(12);
    expect(b.consumedCost).toBe(12);
    expect(b.exhausted).toBe(false);
  });

  it('denies an overspend when the gate roll fails and marks exhausted', () => {
    const b = new InteractionBudget(10, 10, 0, new scriptedRandom([0.99]));
    expect(b.attemptDispatch(12)).toBe('denied');
    expect(b.exhausted).toBe(true);
  });

  it('denies all further dispatches once exhausted', () => {
    const b = new InteractionBudget(10, 10, 0, new scriptedRandom([0.99]));
    b.attemptDispatch(12); // denied
    expect(b.attemptDispatch(1)).toBe('denied');
  });

  it('higher pressure makes denial more likely', () => {
    // With high pressure, probability is very low; a roll of 0.5 fails.
    const b = new InteractionBudget(10, 10, 100, new scriptedRandom([0.5]));
    expect(b.attemptDispatch(12)).toBe('denied');
  });

  it('uses the halved pressure (prospective) in the gate', () => {
    // pressure 4 -> floor(4/2)=2 used; overspend 2, base 10 -> sigmoid(1 - 4/10)
    const prob = overspendProbability(4, 2, 10);
    const ok = new InteractionBudget(10, 10, 4, new scriptedRandom([prob - 0.001]));
    expect(ok.attemptDispatch(12)).toBe('ok');
    const denied = new InteractionBudget(10, 10, 4, new scriptedRandom([prob + 0.001]));
    expect(denied.attemptDispatch(12)).toBe('denied');
  });
});
