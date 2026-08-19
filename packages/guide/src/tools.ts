/**
 * Tool category taxonomy and the {@link ToolRegistry} that enforces it.
 *
 * The Guide's tools fall into four broad categories, as defined by
 * [Tool categories](../../specs/constrained-agent.spec.md#tool-categories). The
 * Guide must not invoke any tool outside the taxonomy; any such call must be
 * rejected with no effect, as required by
 * [Prohibited tools](../../specs/constrained-agent.spec.md#prohibited-tools).
 *
 * @see specs/constrained-agent.spec.md#tool-categories
 */

import type { z } from 'zod';

/**
 * The four permitted tool categories, as defined by
 * [Tool categories](../../specs/constrained-agent.spec.md#tool-categories).
 */
export type ToolCategory =
  'avatar-and-user-interaction' | 'ui-control' | 'knowledge-base-access' | 'agent-self';

const PERMITTED_CATEGORIES: readonly ToolCategory[] = [
  'avatar-and-user-interaction',
  'ui-control',
  'knowledge-base-access',
  'agent-self',
];

/**
 * A tool's declaration: its name, category, parameter and return Zod schemas,
 * a cost, and a human-readable description.
 *
 * The cost represents the resource expenditure of dispatching the tool call
 * and is consumed against the interaction's budget, as defined by
 * [Tool call costs](../../specs/event-system.spec.md#tool-call-costs). The
 * cost and description are included in the tool's definition sent to the
 * model as part of the system prompt, making costs visible to the model at
 * decision time.
 */
export interface ToolDeclaration {
  /** The tool's unique name. */
  name: string;
  /** The tool's category, one of the four permitted categories. */
  category: ToolCategory;
  /** Zod schema validating the tool's parameters. */
  params: z.ZodType;
  /** Zod schema validating the tool's return value. */
  returns: z.ZodType;
  /** The cost consumed against the interaction budget when this tool is dispatched. */
  cost: number;
  /** A human-readable description of the tool, sent to the model. */
  description: string;
}

/**
 * A handler that executes a tool call, returning its value.
 *
 * The handler receives the validated parameters and a
 * {@link ToolDispatchContext}. It returns a promise for the tool's return
 * value, which is validated against the tool's return schema by the registry.
 */
export type ToolHandler = (params: unknown, context: ToolDispatchContext) => Promise<unknown>;

/**
 * Context provided to a {@link ToolHandler} when a tool call is dispatched.
 *
 * The dispatch context carries the budget state so that cost-aware tools can
 * observe remaining budget, and is the seam by which tool handlers reach the
 * service bus or other host capabilities. It is intentionally minimal: tools
 * must not reach the Archive or UI through any channel other than their own
 * handler implementation.
 */
export interface ToolDispatchContext {
  /**
   * The remaining budget at the moment of dispatch. Cost-aware tools (e.g.
   * retrieval with variable cost) may read this to inform their behaviour.
   */
  remainingBudget: number;
  /**
   * An opaque host-provided capability bag. The host injects whatever the
   * registered tools require (e.g. a service client, an avatar controller,
   * a UI controller). Tools must not assume any particular capability is
   * present; they negotiate with the host via the registration contract.
   */
  host: unknown;
  /**
   * Access to the Guide's working memory, provided by the agent loop so that
   * the `update_working_memory` agent-self tool can read and replace the
   * loop's working-memory value, as defined by
   * [Working memory](../../specs/constrained-agent.spec.md#working-memory).
   * The replacement takes effect for the next interaction.
   */
  workingMemory: {
    get: () => unknown;
    set: (value: unknown) => void;
  };
}

/**
 * A registered tool: its declaration plus its handler.
 */
export interface RegisteredTool {
  declaration: ToolDeclaration;
  handler: ToolHandler;
}

/**
 * Error thrown when a tool call is rejected because its name is not a
 * registered tool, its category is not one of the four permitted categories,
 * or its parameters fail validation.
 *
 * Rejected calls become undispatched tool calls, as defined by
 * [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls).
 */
export class ToolRejectedError extends Error {
  /** The reason the call was rejected. */
  readonly reason: 'unknown-tool' | 'prohibited-category' | 'invalid-params';
  constructor(reason: ToolRejectedError['reason'], message: string) {
    super(message);
    this.name = 'ToolRejectedError';
    this.reason = reason;
  }
}

/**
 * An injectable registry of Guide tools. The Guide may only invoke tools
 * within the four categories defined by
 * [Tool categories](../../specs/constrained-agent.spec.md#tool-categories);
 * any call outside the taxonomy is rejected.
 *
 * The registry is the seam between the agent loop and the domain-specific
 * tools. The agent loop owns tool-call discipline, category enforcement, and
 * budget gating; the host registers concrete tools for each category
 * (avatar interaction, UI control, knowledge base access, agent self). The
 * {@link AgentSelfToolSet} provides the agent-self tools defined by the
 * constrained-agent and agent-safety specs; other categories are registered
 * by the host.
 *
 * @see specs/constrained-agent.spec.md#tool-categories
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /**
   * Register a tool. The category must be one of the four permitted
   * categories; registering a tool in any other category is a programming
   * error and throws.
   */
  register(declaration: ToolDeclaration, handler: ToolHandler): void {
    if (!PERMITTED_CATEGORIES.includes(declaration.category)) {
      throw new ToolRejectedError(
        'prohibited-category',
        `Tool "${declaration.name}" has category "${declaration.category}", which is not one of the four permitted categories`,
      );
    }
    if (this.tools.has(declaration.name)) {
      throw new Error(`Tool "${declaration.name}" is already registered`);
    }
    this.tools.set(declaration.name, { declaration, handler });
  }

  /** Whether a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** The declaration for a registered tool, or undefined. */
  declaration(name: string): ToolDeclaration | undefined {
    return this.tools.get(name)?.declaration;
  }

  /** All registered tool declarations, for inclusion in the system prompt. */
  declarations(): ToolDeclaration[] {
    return [...this.tools.values()].map((t) => t.declaration);
  }

  /**
   * Dispatch a tool call. Validates the parameters against the tool's schema,
   * rejects unknown tools and prohibited categories, invokes the handler, and
   * validates the return value.
   *
   * Returns the tool's value on success. Throws {@link ToolRejectedError} for
   * unknown tools, prohibited categories, or invalid parameters; other errors
   * propagate from the handler as dispatch failures.
   */
  async dispatch(name: string, params: unknown, context: ToolDispatchContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolRejectedError('unknown-tool', `Tool "${name}" is not registered`);
    }
    // Category is enforced at registration time, so a registered tool is
    // always in a permitted category. Validate parameters before dispatch.
    const parsed = tool.declaration.params.safeParse(params);
    if (!parsed.success) {
      throw new ToolRejectedError(
        'invalid-params',
        `Tool "${name}" parameters failed validation: ${parsed.error.message}`,
      );
    }
    const result = await tool.handler(parsed.data, context);
    const returnParsed = tool.declaration.returns.safeParse(result);
    if (!returnParsed.success) {
      throw new ToolRejectedError(
        'invalid-params',
        `Tool "${name}" return value failed validation: ${returnParsed.error.message}`,
      );
    }
    return returnParsed.data;
  }
}
