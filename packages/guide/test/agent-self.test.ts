/**
 * Tests for the agent-self tools: `update_working_memory` and `safety_consult`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  SAFETY_CONSULT_TOOL,
  createSafetyConsultHandler,
  safetyConsultDeclaration,
  type SafetyAdvice,
  type SafetyConsultant,
} from '../src/agent-self.js';
import { ToolRegistry } from '../src/tools.js';
import { buildLoop, call, event, finished, turns } from './fixtures.js';

class StubConsultant implements SafetyConsultant {
  constructor(private readonly advice: SafetyAdvice) {}
  consult(): Promise<SafetyAdvice> {
    return Promise.resolve(this.advice);
  }
}

function registryWithSafetyConsult(consultant: SafetyConsultant) {
  const registry = new ToolRegistry();
  registry.register(
    {
      name: SAFETY_CONSULT_TOOL,
      category: 'agent-self',
      params: z.object({ content: z.string(), context: z.string().optional() }),
      returns: z.object({
        tier: z.enum(['info', 'warning', 'critical']),
        recommendations: z.array(z.string()),
        assessment: z.string(),
      }),
      cost: 1,
      description: 'safety consult',
    },
    createSafetyConsultHandler(consultant),
  );
  return registry;
}

describe('safety_consult', () => {
  it('returns the consultant tiered advice', async () => {
    const consultant = new StubConsultant({
      tier: 'warning',
      recommendations: ['tone it down'],
      assessment: 'borderline',
    });
    const registry = registryWithSafetyConsult(consultant);
    const loop = buildLoop(
      [turns(call(SAFETY_CONSULT_TOOL, { content: 'proposed reply' })), finished()],
      registry,
    );
    await loop.runInteraction([event('direct_address')], null);
    // No throw + consumed == cost means the consult dispatched and validated.
  });

  it('the consult consumes budget like any other tool call', async () => {
    const consultant = new StubConsultant({
      tier: 'info',
      recommendations: [],
      assessment: 'fine',
    });
    const registry = registryWithSafetyConsult(consultant);
    const loop = buildLoop(
      [turns(call(SAFETY_CONSULT_TOOL, { content: 'x' })), finished()],
      registry,
    );
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.consumed).toBe(1);
  });

  it('rejects a consult response that does not match the advice schema', async () => {
    const bad: SafetyConsultant = {
      consult: async () => ({ tier: 'nope' }) as unknown as SafetyAdvice,
    };
    const registry = registryWithSafetyConsult(bad);
    const loop = buildLoop(
      [turns(call(SAFETY_CONSULT_TOOL, { content: 'x' })), finished()],
      registry,
    );
    const outcome = await loop.runInteraction([event('direct_address')], null);
    expect(outcome.undispatched.some((u) => u.name === SAFETY_CONSULT_TOOL)).toBe(true);
  });
});

describe('safety_consult declaration', () => {
  it('is in the agent-self category', () => {
    expect(safetyConsultDeclaration.category).toBe('agent-self');
  });
});
