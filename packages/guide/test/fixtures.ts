/**
 * Test helpers and fixtures for the Guide agent loop tests.
 */

import { z } from 'zod';

import { AgentLoop } from '../src/agent-loop.js';
import {
  BudgetTracker,
  DEFAULT_BUDGET_POLICY,
  type BudgetPolicy,
  type RandomSource,
} from '../src/budget.js';
import {
  createUpdateWorkingMemoryHandler,
  updateWorkingMemoryDeclaration,
} from '../src/agent-self.js';
import { ScriptedLlmProvider } from '../src/llm-provider.js';
import { ToolRegistry, type ToolDeclaration, type ToolHandler } from '../src/tools.js';
import type { GuideEvent, ToolCall, TurnOutput } from '../src/model.js';

/** A deterministic randomness source with a fixed sequence of rolls. */
export class scriptedRandom implements RandomSource {
  private rolls: number[];
  private cursor = 0;
  constructor(rolls: number[]) {
    this.rolls = rolls;
  }
  next(): number {
    return this.rolls[this.cursor++] ?? this.rolls[this.rolls.length - 1] ?? 0;
  }
}

/** A minimal event for tests. */
export function event(type: string, payload: unknown = null): GuideEvent {
  return { type, timestamp: 1, payload };
}

/** A tool call for the scripted provider. */
export function call(name: string, params: unknown, callId = name): ToolCall {
  return { name, params, callId };
}

/** A FINISHED turn output. */
export function finished(): TurnOutput {
  return { toolCalls: null, finished: true };
}

/** A tool-calls turn output. */
export function turns(...calls: ToolCall[]): TurnOutput {
  return { toolCalls: calls, finished: false };
}

/**
 * A trivial tool declaration with a string echo handler, for testing the
 * knowledge-base-access / ui-control / avatar categories without their
 * domain specs.
 */
export function echoTool(
  name: string,
  category: 'avatar-and-user-interaction' | 'ui-control' | 'knowledge-base-access',
  cost = 1,
): { declaration: ToolDeclaration; handler: ToolHandler } {
  return {
    declaration: {
      name,
      category,
      params: z.object({ value: z.string() }),
      returns: z.object({ echoed: z.string() }),
      cost,
      description: `echo tool in the ${category} category`,
    },
    handler: async (params) => ({ echoed: (params as { value: string }).value }),
  };
}

/**
 * Build a registry with the two agent-self tools plus any echo tools. The
 * working memory is owned by the agent loop, so the registry no longer holds
 * a working-memory closure; tests inspect working memory via the loop.
 */
export function buildRegistry(
  tools: Array<{ declaration: ToolDeclaration; handler: ToolHandler }> = [],
): { registry: ToolRegistry } {
  const registry = new ToolRegistry();
  registry.register(updateWorkingMemoryDeclaration, createUpdateWorkingMemoryHandler());
  for (const t of tools) {
    registry.register(t.declaration, t.handler);
  }
  return { registry };
}

/**
 * Build an AgentLoop with a scripted provider, default policy, and the given
 * registry and outputs.
 */
export function buildLoop(
  outputs: TurnOutput[],
  registry: ToolRegistry,
  policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
  initialWorkingMemory: unknown = null,
  random?: RandomSource,
): AgentLoop {
  const withRandom = random ? { ...policy, random } : policy;
  return new AgentLoop(
    new ScriptedLlmProvider(outputs),
    registry,
    new BudgetTracker(withRandom),
    withRandom,
    initialWorkingMemory,
  );
}
