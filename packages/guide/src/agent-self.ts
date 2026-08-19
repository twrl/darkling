/**
 * The agent-self tools defined by the constrained-agent and agent-safety specs.
 *
 * The agent-self category affects the Guide's own state only and must not
 * alter the Archive, the UI, or the User's experience, as defined by
 * [Agent self](../../specs/constrained-agent.spec.md#agent-self). This module
 * defines:
 *
 * - `update_working_memory` — the only mechanism by which the Guide may modify
 *   its working memory, as defined by
 *   [Working memory](../../specs/constrained-agent.spec.md#working-memory);
 * - `safety_consult` — the Guide-initiated consultation of a safety
 *   consultant, as defined by [Agent safety](../../specs/agent-safety.spec.md).
 *
 * The `safety_consult` handler invokes the safety consultant through a
 * host-injected {@link SafetyConsultant} so this package remains
 * provider-agnostic.
 *
 * @see specs/constrained-agent.spec.md#agent-self
 * @see specs/agent-safety.spec.md
 */

import { z } from 'zod';

import type { ToolDeclaration, ToolDispatchContext, ToolHandler } from './tools.js';

/**
 * The name of the `update_working_memory` tool.
 */
export const UPDATE_WORKING_MEMORY_TOOL = 'update_working_memory' as const;

/**
 * The name of the `safety_consult` tool.
 */
export const SAFETY_CONSULT_TOOL = 'safety_consult' as const;

/**
 * The parameters of `update_working_memory`: the new JSON value, which
 * replaces the current working memory in its entirety. The replacement is
 * total, not partial, as defined by
 * [`update_working_memory`](../../specs/constrained-agent.spec.md#update_working_memory).
 */
export const updateWorkingMemoryParams = z.object({
  value: z.unknown(),
});

/**
 * The return value of `update_working_memory`: the new working memory value.
 */
export const updateWorkingMemoryReturns = z.unknown();

/**
 * The declaration of the `update_working_memory` tool. The cost is a policy
 * parameter; the default here is a conservative placeholder that the host may
 * override by registering a replacement. Working memory updates are internal
 * state and have no external resource cost, so the default cost is zero.
 */
export const updateWorkingMemoryDeclaration: ToolDeclaration = {
  name: UPDATE_WORKING_MEMORY_TOOL,
  category: 'agent-self',
  params: updateWorkingMemoryParams,
  returns: updateWorkingMemoryReturns,
  cost: 0,
  description:
    'Replace the working memory (an arbitrary JSON value) in its entirety. ' +
    'The replacement takes effect for the next interaction. The replacement ' +
    'is total, not partial: read the current value from the status object, ' +
    'compute the full replacement, and issue this tool with the new value.',
};

/**
 * A factory for the `update_working_memory` handler. The handler reads and
 * replaces the working memory via the {@link ToolDispatchContext}'s
 * working-memory accessor, which the agent loop wires to its own
 * working-memory holder. The replacement takes effect for the next
 * interaction, as required by
 * [Working memory](../../specs/constrained-agent.spec.md#working-memory).
 *
 * The handler returns the new value, confirming the replacement.
 *
 * Note: this factory takes no arguments; the working-memory accessor is
 * provided per-dispatch via the context, so the same handler works across
 * interactions and loop instances.
 */
export function createUpdateWorkingMemoryHandler(): ToolHandler {
  return async (params, context: ToolDispatchContext) => {
    const { value } = params as { value: unknown };
    const previous = context.workingMemory.get();
    context.workingMemory.set(value);
    return { previous, current: value };
  };
}

/**
 * The tiered advice returned by the safety consultant, as defined by
 * [Tiered advice](../../specs/agent-safety.spec.md#tiered-advice).
 */
export type SafetyTier = 'info' | 'warning' | 'critical';

/**
 * The consultant's advice, conforming to the
 * [Advice structure](../../specs/agent-safety.spec.md#advice-structure).
 */
export interface SafetyAdvice {
  /** The severity level: `info`, `warning`, or `critical`. */
  tier: SafetyTier;
  /** One or more recommendations appropriate to the tier. */
  recommendations: string[];
  /** A brief overall assessment of the content's safety. */
  assessment: string;
}

/**
 * The parameters of `safety_consult`: the content or proposed action to
 * assess, together with sufficient context for the consultant to evaluate it.
 */
export const safetyConsultParams = z.object({
  content: z.string(),
  context: z.string().optional(),
});

/**
 * The return value of `safety_consult`: the consultant's tiered advice.
 */
export const safetyConsultReturns = z.object({
  tier: z.enum(['info', 'warning', 'critical']),
  recommendations: z.array(z.string()),
  assessment: z.string(),
});

/**
 * The declaration of the `safety_consult` tool. The cost is a policy parameter
 * (owned by the event system spec); the default is a placeholder that the host
 * should override. It is set to encourage consultation when warranted without
 * being prohibitive, per
 * [Relationship to the budget](../../specs/agent-safety.spec.md#relationship-to-the-budget).
 */
export const safetyConsultDeclaration: ToolDeclaration = {
  name: SAFETY_CONSULT_TOOL,
  category: 'agent-self',
  params: safetyConsultParams,
  returns: safetyConsultReturns,
  cost: 1,
  description:
    'Consult the safety consultant on potentially unsafe content or a ' +
    'proposed action, without breaking character. Returns tiered advice: ' +
    '"info" (consider, may act or not), "warning" (adjust responses, keep ' +
    'consulting), or "critical" (defer to the consultant; do not produce ' +
    'advised-against content). The User does not see that a consult occurred.',
};

/**
 * The safety consultant: a separate LLM agent invoked by `safety_consult`,
 * as defined by
 * [The safety consultant](../../specs/agent-safety.spec.md#the-safety-consultant).
 *
 * The consultant is host-injected so that this package remains
 * provider-agnostic. It receives the content and context and returns advice.
 * If the consultant is unavailable, the call rejects; the Guide's behaviour
 * in that case falls back on its prompt-level safety guidance, as noted in
 * the agent-safety journal.
 */
export interface SafetyConsultant {
  consult(content: string, context?: string): Promise<SafetyAdvice>;
}

/**
 * A factory for the `safety_consult` handler. The handler delegates to the
 * host-injected {@link SafetyConsultant}.
 *
 * @param consultant - the safety consultant.
 */
export function createSafetyConsultHandler(consultant: SafetyConsultant): ToolHandler {
  return async (params) => {
    const { content, context } = params as { content: string; context?: string };
    return consultant.consult(content, context);
  };
}
