/**
 * @darkling/guide — the Guide's constrained-agent loop.
 *
 * Implements the agentic logic for the Guide: the turn-by-turn interaction
 * loop, tool-call discipline and four-category taxonomy, cost-based budget
 * enforcement, working memory, the FINISHED control signal, undispatched tool
 * calls, and the `safety_consult` agent-self tool.
 *
 * @see specs/constrained-agent.spec.md
 * @see specs/event-system.spec.md
 * @see specs/three-way-interaction.spec.md
 * @see specs/agent-safety.spec.md
 */

// Core model types
export type {
  BudgetStatus,
  GuideEvent,
  InteractionInput,
  InteractionOutcome,
  InteractionStatus,
  ToolCall,
  ToolResult,
  TurnOutput,
  UndispatchedToolCall,
} from './model.js';

export { FINISHED } from './model.js';

// Tool registry and categories
export type {
  ToolCategory,
  ToolDeclaration,
  ToolDispatchContext,
  ToolHandler,
  RegisteredTool,
} from './tools.js';

export { ToolRegistry, ToolRejectedError } from './tools.js';

// Agent-self tools
export type { SafetyAdvice, SafetyConsultant, SafetyTier } from './agent-self.js';

export {
  UPDATE_WORKING_MEMORY_TOOL,
  SAFETY_CONSULT_TOOL,
  updateWorkingMemoryParams,
  updateWorkingMemoryReturns,
  updateWorkingMemoryDeclaration,
  createUpdateWorkingMemoryHandler,
  safetyConsultParams,
  safetyConsultReturns,
  safetyConsultDeclaration,
  createSafetyConsultHandler,
} from './agent-self.js';

// Budget policy
export type { BudgetPolicy, RandomSource, DispatchAttempt } from './budget.js';

export {
  DEFAULT_BUDGET_POLICY,
  DEFAULT_RANDOM,
  BudgetTracker,
  InteractionBudget,
  MathRandom,
  sigmoid,
  overspendProbability,
} from './budget.js';

// LLM provider
export type {
  HttpLlmProviderOptions,
  HttpLlmRequestBody,
  HttpLlmResponseBody,
  LlmProvider,
  LlmTurnRequest,
  TurnResultEntry,
} from './llm-provider.js';

export { HttpLlmProvider, ScriptedLlmProvider } from './llm-provider.js';

// OpenRouter upstream provider (backend-side)
export type { OpenRouterLlmProviderOptions } from './openrouter-provider.js';

export { OpenRouterLlmProvider } from './openrouter-provider.js';

// Agent loop
export type { AgentLoopOptions } from './agent-loop.js';

export { AgentLoop } from './agent-loop.js';

// Service-bus integration
export type { GuideServiceOptions, GuideServiceDeclaration } from './service-implementation.js';

export { GuideService } from './service-implementation.js';

export { declaration as guideServiceDeclaration } from './service-declaration.js';
