/**
 * Tests for the frontend Guide service: option reading and dependency building.
 *
 * The Guide worker builds the loop's non-serialisable dependencies (the
 * `HttpLlmProvider`, `ToolRegistry`, and `BudgetTracker`) from serialisable
 * config carried across the worker boundary via the service registration's
 * `options.guide` bag, as defined by the service-bus worker-protocol extension
 * (see `packages/service-bus/package.journal.md`).
 *
 * @see apps/frontend/src/workers/guide-service.ts
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_BUDGET_POLICY } from '@darkling/guide';

import {
  buildGuideServiceOptions,
  readOptions,
  type FrontendGuideOptions,
} from '../src/workers/guide-service.js';
import type { HostContext } from '@darkling/service-bus';

/** A minimal host context carrying options, matching the worker-protocol shape. */
function contextWith(options: Record<string, unknown>): HostContext {
  return { serviceClient: {} as never, options };
}

describe('readOptions', () => {
  it('reads options from the worker-protocol options bag keyed by service ID', () => {
    const ctx = contextWith({ guide: { llmEndpoint: '/llm/turn' } });
    expect(readOptions(ctx)).toEqual({ llmEndpoint: '/llm/turn' });
  });

  it('falls back to the top-level hostContext.guide (in-process form)', () => {
    const ctx = {
      serviceClient: {} as never,
      guide: { llmEndpoint: '/llm/turn' } satisfies FrontendGuideOptions,
    } as HostContext;
    expect(readOptions(ctx)).toEqual({ llmEndpoint: '/llm/turn' });
  });

  it('throws when llmEndpoint is missing', () => {
    expect(() => readOptions(contextWith({}))).toThrow(/llmEndpoint/);
  });

  it('throws when no options are provided', () => {
    expect(() => readOptions({ serviceClient: {} as never } as HostContext)).toThrow(/llmEndpoint/);
  });
});

describe('buildGuideServiceOptions', () => {
  it('constructs an HttpLlmProvider from the endpoint', () => {
    const opts = buildGuideServiceOptions({ llmEndpoint: '/llm/turn' });
    // The provider is an HttpLlmProvider; its endpoint is internal, so we
    // assert it dispatches a fetch when turned. Here we just assert it exists
    // and the registry + budget policy are wired.
    expect(opts.provider).toBeDefined();
    expect(typeof (opts.provider as { turn?: unknown }).turn).toBe('function');
  });

  it('registers the update_working_memory agent-self tool', () => {
    const opts = buildGuideServiceOptions({ llmEndpoint: '/llm/turn' });
    expect(opts.registry.has('update_working_memory')).toBe(true);
  });

  it('does not register the safety_consult tool (consultant not implemented)', () => {
    const opts = buildGuideServiceOptions({ llmEndpoint: '/llm/turn' });
    expect(opts.registry.has('safety_consult')).toBe(false);
  });

  it('defaults the budget policy to DEFAULT_BUDGET_POLICY when omitted', () => {
    const opts = buildGuideServiceOptions({ llmEndpoint: '/llm/turn' });
    expect(opts.budgetPolicy).toBe(DEFAULT_BUDGET_POLICY);
  });

  it('uses the provided budget policy and initial working memory', () => {
    const policy = { ...DEFAULT_BUDGET_POLICY, base: 42 };
    const opts = buildGuideServiceOptions({
      llmEndpoint: '/llm/turn',
      budgetPolicy: policy,
      initialWorkingMemory: { topic: 'ceph-biology' },
      maxTurns: 5,
    });
    expect(opts.budgetPolicy).toBe(policy);
    expect(opts.initialWorkingMemory).toEqual({ topic: 'ceph-biology' });
    expect(opts.loopOptions).toEqual({ maxTurns: 5 });
  });

  it('defaults initial working memory to null and loopOptions to undefined', () => {
    const opts = buildGuideServiceOptions({ llmEndpoint: '/llm/turn' });
    expect(opts.initialWorkingMemory).toBeNull();
    expect(opts.loopOptions).toBeUndefined();
  });
});
