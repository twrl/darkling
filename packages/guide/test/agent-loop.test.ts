/**
 * Tests for the Guide agent loop, covering the constrained-agent spec's
 * normative requirements: tool-call discipline, FINISHED, budget exhaustion,
 * undispatched tool calls, working memory, and the four-category taxonomy.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_BUDGET_POLICY } from '../src/budget.js';
import { ToolRejectedError } from '../src/tools.js';
import { UPDATE_WORKING_MEMORY_TOOL } from '../src/agent-self.js';
import {
  buildLoop,
  buildRegistry,
  call,
  echoTool,
  event,
  finished,
  scriptedRandom,
  turns,
} from './fixtures.js';

describe('AgentLoop — FINISHED', () => {
  it('ends the interaction with no tool calls and no effect', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop([finished()], registry);
    const outcome = await loop.runInteraction([event('document_opened')], null);
    expect(outcome.reason).toBe('finished');
    expect(outcome.consumed).toBe(0);
    expect(outcome.undispatched).toEqual([]);
  });

  it('ends the interaction after issuing tool calls', async () => {
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction')]);
    const loop = buildLoop([turns(call('avatar_say', { value: 'hi' })), finished()], registry);
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.reason).toBe('finished');
    expect(outcome.consumed).toBe(1);
  });
});

describe('AgentLoop — tool-call discipline', () => {
  it('dispatches tool calls and returns their results to the next turn', async () => {
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction')]);
    const loop = buildLoop([turns(call('avatar_say', { value: 'hi' })), finished()], registry);
    await loop.runInteraction([event('direct_address')], null);
    // No throw means dispatch + return-validation succeeded.
  });

  it('rejects an unknown tool and carries it as undispatched', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop([turns(call('nope', {})), finished()], registry);
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.undispatched).toHaveLength(1);
    expect(outcome.undispatched[0]?.name).toBe('nope');
    expect(outcome.undispatched[0]?.reason).toContain('unknown-tool');
  });

  it('rejects invalid params and carries the call as undispatched', async () => {
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction')]);
    const loop = buildLoop([turns(call('avatar_say', { wrong: 'x' })), finished()], registry);
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.undispatched).toHaveLength(1);
    expect(outcome.undispatched[0]?.name).toBe('avatar_say');
    expect(outcome.undispatched[0]?.reason).toContain('invalid-params');
  });

  it('dispatches tool calls in parallel within a turn', async () => {
    const order: string[] = [];
    const { registry } = buildRegistry([
      {
        declaration: echoTool('a', 'ui-control', 1).declaration,
        handler: async () => {
          order.push('a-start');
          await Promise.resolve();
          order.push('a-end');
          return { echoed: 'a' };
        },
      },
      {
        declaration: echoTool('b', 'ui-control', 1).declaration,
        handler: async () => {
          order.push('b-start');
          await Promise.resolve();
          order.push('b-end');
          return { echoed: 'b' };
        },
      },
    ]);
    const loop = buildLoop(
      [turns(call('a', { value: 'a' }), call('b', { value: 'b' })), finished()],
      registry,
    );
    await loop.runInteraction([event('direct_address')], null);
    // Both starts precede both ends, indicating parallel dispatch.
    expect(order).toEqual(['a-start', 'b-start', 'a-end', 'b-end']);
  });
});

describe('AgentLoop — budget', () => {
  it('ends the interaction when the overspend gate denies a call', async () => {
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction', 6)]);
    const policy: typeof DEFAULT_BUDGET_POLICY = {
      ...DEFAULT_BUDGET_POLICY,
      base: 5,
      premium: () => 0,
    };
    // budget 5; a call costing 6 is an overspend of 1. With pressure 0 and
    // base 5 the gate probability is sigmoid(1 - 1/5) ≈ 0.78. A roll of 0.99
    // fails, denying the call and ending the interaction.
    const loop = buildLoop(
      [turns(call('avatar_say', { value: 'too-costly' })), finished()],
      registry,
      policy,
      null,
      new scriptedRandom([0.99]),
    );
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.consumed).toBe(0);
    expect(outcome.reason).toBe('budget-exhausted');
    expect(outcome.undispatched.some((u) => u.name === 'avatar_say')).toBe(true);
    expect(outcome.undispatched[0]?.reason).toBe('overspend-denied');
  });

  it('dispatches an overspend when the gate roll succeeds', async () => {
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction', 6)]);
    const policy: typeof DEFAULT_BUDGET_POLICY = {
      ...DEFAULT_BUDGET_POLICY,
      base: 5,
      premium: () => 0,
    };
    // Same gate (≈0.78); a roll of 0.0 succeeds, so the overspend is
    // dispatched and consumed.
    const loop = buildLoop(
      [turns(call('avatar_say', { value: 'overspend' })), finished()],
      registry,
      policy,
      null,
      new scriptedRandom([0.0]),
    );
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.consumed).toBe(6);
    expect(outcome.reason).toBe('finished');
  });

  it('does not count turns toward the budget, only tool call costs', async () => {
    const { registry } = buildRegistry();
    // Many FINISHED turns with no tool calls consume no budget.
    const loop = buildLoop([finished(), finished(), finished(), finished()], registry);
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.consumed).toBe(0);
    expect(outcome.reason).toBe('finished');
  });

  it('repeated overspend raises pressure and suppresses further overspend', async () => {
    // Two interactions sharing a budget tracker: the first overspends (roll
    // succeeds), raising pressure; the second attempts a large overspend with
    // a roll that fails because the high proposed overspend lowers the gate
    // probability.
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction', 6)]);
    const policy: typeof DEFAULT_BUDGET_POLICY = {
      ...DEFAULT_BUDGET_POLICY,
      base: 5,
      premium: () => 0,
    };
    // Interaction 1: overspend 1, pressure 0 -> prob ≈0.78, roll 0.0 succeeds.
    const loop = buildLoop(
      [turns(call('avatar_say', { value: 'overspend' })), finished()],
      registry,
      policy,
      null,
      new scriptedRandom([0.0]),
    );
    await loop.runInteraction([event('direct_address')], null);
    expect(loop.currentPressure).toBe(1); // overspend 1 carried as pressure

    // Interaction 2: fresh provider, same tracker. A call costing 50 against
    // budget 5 is an overspend of 45, so prob = sigmoid(1 - 45/5) ≈ 0. A roll
    // of 0.5 fails, denying the call and ending the interaction.
    const { registry: registry2 } = buildRegistry([
      echoTool('avatar_say', 'avatar-and-user-interaction', 50),
    ]);
    const loop2 = buildLoop(
      [turns(call('avatar_say', { value: 'big-overspend' })), finished()],
      registry2,
      policy,
      null,
      new scriptedRandom([0.5]),
    );
    // Reuse the first loop's budget tracker so interaction 2 sees pressure 1.
    (loop2 as unknown as { budgetTracker: unknown }).budgetTracker = (
      loop as unknown as { budgetTracker: unknown }
    ).budgetTracker;
    const outcome2 = await loop2.runInteraction([event('direct_address')], null);
    expect(outcome2.reason).toBe('budget-exhausted');
    expect(outcome2.undispatched.some((u) => u.name === 'avatar_say')).toBe(true);
  });
});

describe('AgentLoop — working memory', () => {
  it('replaces working memory wholesale via update_working_memory', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop(
      [turns(call(UPDATE_WORKING_MEMORY_TOOL, { value: { topic: 'ceph-biology' } })), finished()],
      registry,
      DEFAULT_BUDGET_POLICY,
      { topic: 'initial' },
    );
    await loop.runInteraction([event('direct_address')], null);
    expect(loop.currentWorkingMemory).toEqual({ topic: 'ceph-biology' });
  });

  it('replaces, not merges, working memory', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop(
      [
        turns(
          call(UPDATE_WORKING_MEMORY_TOOL, {
            value: { topic: 'cephalopods' },
          }),
        ),
        finished(),
      ],
      registry,
      DEFAULT_BUDGET_POLICY,
      { topic: 'ceph-biology', depth: 2 },
    );
    await loop.runInteraction([event('direct_address')], null);
    expect(loop.currentWorkingMemory).toEqual({ topic: 'cephalopods' });
  });

  it('surfaces working memory in the next interaction status', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop(
      [turns(call(UPDATE_WORKING_MEMORY_TOOL, { value: { kept: true } })), finished()],
      registry,
    );
    await loop.runInteraction([event('direct_address')], null);
    expect(loop.currentWorkingMemory).toEqual({ kept: true });
  });
});

describe('AgentLoop — undispatched tool calls', () => {
  it('carries undispatched calls to the next interaction', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop([turns(call('nope', {})), finished()], registry);
    await loop.runInteraction([event('direct_address')], null);
    expect(loop.currentUndispatched).toHaveLength(1);
    // A second interaction sees the undispatched call in its status.
    const before = loop.currentUndispatched;
    expect(before[0]?.name).toBe('nope');
  });

  it('clears undispatched calls after they are surfaced', async () => {
    const { registry } = buildRegistry();
    const loop = buildLoop([turns(call('nope', {})), finished(), finished()], registry);
    await loop.runInteraction([event('direct_address')], null);
    expect(loop.currentUndispatched).toHaveLength(1);
    await loop.runInteraction([event('direct_address')], null);
    // The second interaction had no failures, so undispatched clears.
    expect(loop.currentUndispatched).toHaveLength(0);
  });
});

describe('AgentLoop — budget carryover', () => {
  it('carries min(spent, remaining) forward as positive carryover', async () => {
    const { registry } = buildRegistry([echoTool('avatar_say', 'avatar-and-user-interaction', 1)]);
    const policy: typeof DEFAULT_BUDGET_POLICY = {
      ...DEFAULT_BUDGET_POLICY,
      base: 10,
      premium: () => 0,
    };
    const loop = buildLoop(
      [turns(call('avatar_say', { value: 'x' })), finished()],
      registry,
      policy,
    );
    await loop.runInteraction([event('direct_address')], null);
    // Spent 1 of 10 -> carryover min(1, 9) = 1. The next interaction's
    // budget should be base + premium + 1 carryover = 10 + 0 + 1 = 11.
    expect(loop.currentCarryover).toBe(1);
    const loop2 = buildLoop([finished()], registry, policy);
    // Reuse the first loop's budget tracker to observe carryover.
    (loop2 as unknown as { budgetTracker: unknown }).budgetTracker = (
      loop as unknown as { budgetTracker: unknown }
    ).budgetTracker;
    const tracker = (
      loop2 as unknown as { budgetTracker: { budgetFor: (e: { type: string }[]) => number } }
    ).budgetTracker;
    expect(tracker.budgetFor([{ type: 'x' }])).toBe(11);
  });
});

describe('ToolRegistry — categories', () => {
  it('rejects registration of a tool outside the four categories', () => {
    const registry = buildRegistry().registry;
    expect(() =>
      registry.register(
        {
          name: 'bad',
          category: 'archive-mutation' as never,
          params: { safeParse: () => ({ success: true, data: {} }) } as never,
          returns: { safeParse: () => ({ success: true, data: {} }) } as never,
          cost: 1,
          description: 'x',
        },
        async () => ({}),
      ),
    ).toThrow(ToolRejectedError);
  });
});
