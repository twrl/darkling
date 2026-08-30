/**
 * An OpenRouter {@link LlmProvider} — an upstream provider implementation
 * that calls the OpenRouter chat completions API.
 *
 * This is the backend-side provider: the backend holds the OpenRouter API
 * key and forwards the Guide's constrained-agent turn requests to OpenRouter,
 * as defined by
 * [LLM proxy](../../specs/usage-and-deployment.spec.md#llm-proxy) and
 * [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction).
 * It must not be used on the frontend; the API key must stay server-side.
 *
 * The provider maps the constrained-agent turn model to OpenRouter's
 * OpenAI-compatible chat completions API:
 *
 * - the interaction input (event queue, status object) is rendered into a
 *   system message describing the Guide's situation, as defined by
 *   [Interaction input](../../specs/constrained-agent.spec.md#interaction-input);
 * - the registered tools are emitted as OpenAI function tools, with their
 *   Zod parameter schemas converted to JSON Schema via `z.toJSONSchema`;
 * - the previous turn's tool results are sent as `tool` messages, as defined
 *   by [Turns](../../specs/constrained-agent.spec.md#turns);
 * - the model's `tool_calls` are mapped to {@link ToolCall}s, and
 *   `finish_reason: "stop"` (and the other non-`tool_calls` finish reasons)
 *   are mapped to FINISHED, as defined by
 *   [FINISHED](../../specs/constrained-agent.spec.md#finished).
 *
 * Only non-streaming completions are supported. The agent loop awaits the
 * full turn output per turn, so streaming offers no behavioural benefit for
 * the loop's turn-at-a-time model.
 *
 * @see https://openrouter.ai/docs/api-reference/overview
 * @see specs/usage-and-deployment.spec.md#llm-provider-abstraction
 * @see specs/constrained-agent.spec.md
 */

import { toJSONSchema } from 'zod';

import type { InteractionInput, ToolCall, TurnOutput } from './model.js';
import type { LlmProvider, LlmTurnRequest, TurnResultEntry } from './llm-provider.js';
import type { ToolDeclaration } from './tools.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('guide:provider');

/**
 * Options for the {@link OpenRouterLlmProvider}.
 */
export interface OpenRouterLlmProviderOptions {
  /** The OpenRouter API key. Must be held server-side; never sent to the frontend. */
  apiKey: string;
  /**
   * The model to use, including the organisation prefix (e.g.
   * `openai/gpt-4o`, `anthropic/claude-sonnet-4.6`). See OpenRouter's
   * supported models. If omitted, the user/payer's default is used.
   */
  model?: string;
  /**
   * The OpenRouter chat completions endpoint. Defaults to the public API.
   * Overridable for testing or for a self-hosted gateway.
   */
  endpoint?: string;
  /**
   * A fetch implementation. Defaults to the global `fetch`. The backend may
   * inject a custom fetch (e.g. for testing or to route through a proxy).
   */
  fetch?: typeof fetch;
  /**
   * Optional site URL, sent as `HTTP-Referer` for OpenRouter app attribution.
   */
  siteUrl?: string;
  /** Optional site title, sent as `X-Title` for OpenRouter app attribution. */
  siteTitle?: string;
  /** Optional sampling temperature, in [0, 2]. */
  temperature?: number;
  /** Optional maximum number of tokens to generate. */
  maxTokens?: number;
}

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * The OpenRouter chat completions request shape, restricted to the fields
 * this provider sends. OpenRouter's schema is OpenAI-compatible; this is the
 * subset needed for the constrained-agent turn.
 */
interface OpenRouterRequest {
  model?: string;
  messages: OpenRouterMessage[];
  tools?: Array<{ type: 'function'; function: OpenRouterFunctionTool }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream: false;
}

/** A single chat message in the OpenRouter request. */
type OpenRouterMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenRouterToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** An OpenAI-style function tool declaration. */
interface OpenRouterFunctionTool {
  name: string;
  description: string;
  parameters: object;
}

/** An OpenAI-style tool call in a response or assistant message. */
interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** The OpenRouter non-streaming response shape, restricted to the fields read. */
interface OpenRouterResponse {
  choices: Array<{
    finish_reason: string | null;
    message: {
      content: string | null;
      role: string;
      tool_calls?: OpenRouterToolCall[];
    };
    error?: { code: number; message: string };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number;
  };
}

/**
 * An {@link LlmProvider} that calls the OpenRouter chat completions API.
 *
 * This is the upstream provider used by the backend's LLM proxy. It maps the
 * constrained-agent turn model onto OpenRouter's OpenAI-compatible API and
 * maps the provider's completion signal to FINISHED, as required by
 * [FINISHED](../../specs/constrained-agent.spec.md#finished).
 */
export class OpenRouterLlmProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly siteUrl: string | undefined;
  private readonly siteTitle: string | undefined;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;

  constructor(options: OpenRouterLlmProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OpenRouterLlmProvider requires an apiKey');
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    // Bind the default fetch to globalThis so a bare reference isn't detached
    // from its scope (e.g. Node's undici fetch or a worker's fetch would throw
    // "Illegal invocation" if called unbound).
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.siteUrl = options.siteUrl;
    this.siteTitle = options.siteTitle;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
  }

  async turn(request: LlmTurnRequest): Promise<TurnOutput> {
    const body = this.buildRequestBody(request);
    log.debug('openrouter request', {
      model: this.model,
      messages: body.messages.length,
      tools: body.tools?.length ?? 0,
    });
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn('openrouter error response', {
        status: response.status,
        statusText: response.statusText,
        model: this.model,
      });
      throw new Error(
        `OpenRouter returned ${response.status}: ${response.statusText}${text ? ` — ${text}` : ''}`,
      );
    }
    const data = (await response.json()) as OpenRouterResponse;
    const output = this.parseResponse(data);
    log.debug('openrouter response', {
      finished: output.finished,
      toolCalls: output.toolCalls?.length ?? 0,
    });
    return output;
  }

  /** Build the OpenRouter chat completions request body for a turn. */
  private buildRequestBody(request: LlmTurnRequest): OpenRouterRequest {
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: this.systemMessage(request.input) },
      { role: 'user', content: this.userMessage(request.input) },
    ];

    // Append the previous turn's tool results as tool messages, preceded by
    // an assistant message carrying the tool calls those results answer.
    if (request.previousResults && request.previousResults.length > 0) {
      messages.push(...this.toolResultMessages(request.previousResults));
    }

    const req: OpenRouterRequest = {
      model: this.model,
      messages,
      stream: false,
    };
    if (request.tools.length > 0) {
      req.tools = request.tools.map((t) => this.toFunctionTool(t));
      req.tool_choice = 'auto';
    }
    if (this.temperature !== undefined) req.temperature = this.temperature;
    if (this.maxTokens !== undefined) req.max_tokens = this.maxTokens;
    return req;
  }

  /** Build the request headers, including OpenRouter attribution headers. */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.siteTitle) headers['X-Title'] = this.siteTitle;
    return headers;
  }

  /**
   * Render the interaction input's status object as a system message. The
   * status object carries the budget, working memory, and undispatched tool
   * calls, as defined by
   * [Interaction input](../../specs/constrained-agent.spec.md#interaction-input).
   * The Guide reads this to inform its decisions.
   */
  private systemMessage(input: InteractionInput): string {
    const { budget, workingMemory, undispatched } = input.status;
    const parts: string[] = [
      'You are the Guide, a constrained agent. You respond entirely through tool calls; free text is not permitted.',
      'In each turn, either issue one or more tool calls, or return FINISHED to end the interaction.',
      'Do not assert facts about Archive content without having retrieved it through a prior knowledge-base-access tool call.',
      '',
      `Budget for this interaction: total ${budget.total}, consumed ${budget.consumed}, remaining ${budget.remaining}.`,
      `Working memory: ${JSON.stringify(workingMemory)}`,
    ];
    if (undispatched.length > 0) {
      parts.push(
        `Undispatched tool calls from the previous interaction (you may reissue or discard them; discarding produces no error): ${JSON.stringify(undispatched)}`,
      );
    }
    return parts.join('\n');
  }

  /**
   * Render the event queue as a user message. The events describe the User's
   * activity that triggered this interaction, as defined by
   * [Constrained agent](../../specs/constrained-agent.spec.md#events).
   */
  private userMessage(input: InteractionInput): string {
    const events = input.eventQueue.map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      payload: e.payload,
    }));
    return `The following events have accumulated and triggered this interaction. Respond with tool calls, or return FINISHED to decline.\n\nEvents: ${JSON.stringify(events)}`;
  }

  /**
   * Render the previous turn's tool results as OpenRouter messages: an
   * assistant message carrying the tool calls (so the tool messages have a
   * matching tool_call_id), followed by a `tool` message per result.
   *
   * OpenRouter (like OpenAI) requires that `tool` messages follow an
   * assistant message whose `tool_calls` reference the same ids. We
   * synthesise the assistant message from the results, since the loop's
   * previous-turn output is represented as results rather than as a
   * retained assistant message.
   */
  private toolResultMessages(results: TurnResultEntry[]): OpenRouterMessage[] {
    const assistantToolCalls: OpenRouterToolCall[] = results.map((r) => ({
      id: r.callId,
      type: 'function',
      function: {
        name: r.name,
        arguments: JSON.stringify({}),
      },
    }));
    const messages: OpenRouterMessage[] = [
      { role: 'assistant', content: null, tool_calls: assistantToolCalls },
    ];
    for (const r of results) {
      messages.push({
        role: 'tool',
        tool_call_id: r.callId,
        content: r.ok ? JSON.stringify(r.value ?? null) : `error: ${r.error ?? 'unknown'}`,
      });
    }
    return messages;
  }

  /**
   * Convert a {@link ToolDeclaration} to an OpenAI-style function tool, with
   * the Zod parameter schema converted to a JSON Schema via `z.toJSONSchema`.
   */
  private toFunctionTool(tool: ToolDeclaration): {
    type: 'function';
    function: OpenRouterFunctionTool;
  } {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toJSONSchema(tool.params, { target: 'draft-2020-12' }),
      },
    };
  }

  /**
   * Parse an OpenRouter response into a {@link TurnOutput}. Tool calls become
   * {@link ToolCall}s; a `finish_reason` other than `tool_calls` is mapped to
   * FINISHED, as defined by
   * [FINISHED](../../specs/constrained-agent.spec.md#finished) (FINISHED is an
   * abstraction over the provider's completion signal; `stop`, `length`,
   * `content_filter`, and `error` all end the interaction).
   */
  private parseResponse(data: OpenRouterResponse): TurnOutput {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('OpenRouter response contained no choices');
    }
    if (choice.error) {
      throw new Error(`OpenRouter choice error: ${choice.error.message}`);
    }
    const toolCalls = choice.message.tool_calls;
    if (toolCalls && toolCalls.length > 0 && choice.finish_reason === 'tool_calls') {
      const calls: ToolCall[] = toolCalls.map((tc) => ({
        name: tc.function.name,
        params: parseToolArguments(tc.function.arguments),
        callId: tc.id,
      }));
      return { toolCalls: calls, finished: false };
    }
    // Any non-`tool_calls` finish reason ends the interaction: the model
    // produced no further tool calls. This covers `stop` (the normal
    // FINISHED case), `length`, `content_filter`, and `error`.
    return { toolCalls: null, finished: true };
  }
}

/**
 * Parse a tool call's `arguments` JSON string into a parameter object.
 * OpenRouter returns tool arguments as a JSON string; if it is not valid
 * JSON, the call is still emitted with the raw string so the tool registry's
 * Zod validation rejects it (and it becomes an undispatched call) rather than
 * crashing the turn.
 */
function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    return argumentsJson;
  }
}
