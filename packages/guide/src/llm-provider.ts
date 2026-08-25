/**
 * The LLM provider abstraction: the provider-agnostic interface by which the
 * Guide's constrained-agent loop invokes the model.
 *
 * The backend abstracts the LLM behind a provider interface, as defined by
 * [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction).
 * The provider is a configuration choice; the frontend's Guide agent loop
 * calls the backend to invoke the LLM, and the backend forwards to the
 * configured provider and returns the response. The API key is held by the
 * backend, not the frontend.
 *
 * The provider interface accommodates the constrained agent's interaction
 * model: the backend receives the prompt/status input (event queue, budget,
 * working memory, undispatched tool calls, tool definitions) and returns the
 * model's response (tool calls and the FINISHED signal), as defined by
 * [Constrained agent](../../specs/constrained-agent.spec.md) and
 * [Interaction input](../../specs/constrained-agent.spec.md#interaction-input).
 *
 * This module defines the {@link LlmProvider} interface and an
 * {@link HttpLlmProvider} client that calls the backend's LLM proxy over
 * HTTP. The host may substitute another provider (e.g. a scripted mock for
 * tests) by implementing {@link LlmProvider} directly.
 *
 * @see specs/usage-and-deployment.spec.md#llm-provider-abstraction
 * @see specs/constrained-agent.spec.md
 */

import type { z } from 'zod';

import type { InteractionInput, ToolCall, TurnOutput } from './model.js';
import type { ToolDeclaration } from './tools.js';
import { createLogger } from '@darkling/observability';

const log = createLogger('guide:provider');

/**
 * The request sent to the LLM provider for a turn: the interaction input, the
 * tool definitions (with costs, so the model can weigh cost against remaining
 * budget, as required by [Tool call costs](../../specs/event-system.spec.md#tool-call-costs)),
 * and the tool results from the previous turn (for subsequent turns).
 */
export interface LlmTurnRequest {
  /** The interaction input (event queue + status object). */
  input: InteractionInput;
  /** The registered tool declarations, with costs, for the system prompt. */
  tools: ToolDeclaration[];
  /** The results of the previous turn's tool calls, for subsequent turns. */
  previousResults?: TurnResultEntry[];
}

/** A tool result entry forwarded to the model for the next turn. */
export interface TurnResultEntry {
  /** The call id of the tool call this result corresponds to. */
  callId: string;
  /** The tool name. */
  name: string;
  /** Whether the call succeeded. */
  ok: boolean;
  /** The tool's return value, when ok. */
  value?: unknown;
  /** The error description, when not ok. */
  error?: string;
}

/**
 * A provider-agnostic LLM provider. The Guide's agent loop invokes the model
 * through this interface once per turn, receiving tool calls or FINISHED, as
 * defined by [Turns](../../specs/constrained-agent.spec.md#turns).
 *
 * Implementations map the constrained-agent model to the underlying
 * provider's API. FINISHED is an abstraction over the provider's completion
 * signal (e.g. OpenAI's `finish_reason: "stop"`); an implementation must map
 * the provider's signal to FINISHED and treat it uniformly, as defined by
 * [FINISHED](../../specs/constrained-agent.spec.md#finished).
 */
export interface LlmProvider {
  /**
   * Invoke the model for one turn. Returns the model's tool calls or
   * FINISHED. Must not return free text: the model's output in a turn is one
   * of one or more tool calls, or FINISHED, as defined by
   * [Model output](../../specs/constrained-agent.spec.md#model-output).
   */
  turn(request: LlmTurnRequest): Promise<TurnOutput>;
}

/**
 * The JSON body the HTTP LLM provider sends to the backend proxy, and the
 * response it expects. The wire format is an implementation detail of the
 * backend proxy; this module defines a default contract that the backend is
 * expected to honour. The contract mirrors the constrained-agent model: the
 * request carries the interaction input, tool definitions, and previous
 * results; the response carries tool calls or the FINISHED signal.
 */
export interface HttpLlmRequestBody {
  input: InteractionInput;
  tools: Array<{
    name: string;
    category: string;
    cost: number;
    description: string;
    params: z.ZodType;
    returns: z.ZodType;
  }>;
  previousResults?: TurnResultEntry[];
}

/** The response body from the backend LLM proxy. */
export interface HttpLlmResponseBody {
  /** The tool calls issued by the model, or null when the model returned FINISHED. */
  toolCalls: ToolCall[] | null;
  /** True when the model returned FINISHED. */
  finished: boolean;
}

/**
 * Options for the {@link HttpLlmProvider}.
 */
export interface HttpLlmProviderOptions {
  /** The backend LLM proxy endpoint URL. */
  endpoint: string;
  /**
   * A fetch implementation. Defaults to the global `fetch`. The host may
   * inject a custom fetch (e.g. for testing, or to route through the Service
   * Worker that attaches the bearer token, as defined by
   * [Service Worker token handling](../../specs/usage-and-deployment.spec.md#service-worker-token-handling)).
   */
  fetch?: typeof fetch;
}

/**
 * An {@link LlmProvider} that calls the backend's LLM proxy over HTTP, as
 * defined by [LLM proxy](../../specs/usage-and-deployment.spec.md#llm-proxy).
 *
 * The backend holds the LLM API key and forwards the request to the
 * configured provider; the API key is never sent to the frontend. The token
 * is attached transparently by the Service Worker, so this client makes an
 * ordinary `fetch` call.
 */
export class HttpLlmProvider implements LlmProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpLlmProviderOptions) {
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async turn(request: LlmTurnRequest): Promise<TurnOutput> {
    const body: HttpLlmRequestBody = {
      input: request.input,
      tools: request.tools,
      previousResults: request.previousResults,
    };
    log.debug('llm proxy request', {
      endpoint: this.endpoint,
      toolCount: request.tools.length,
      previousResults: request.previousResults?.length ?? 0,
    });
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      log.warn('llm proxy error response', {
        endpoint: this.endpoint,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`LLM proxy returned ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as HttpLlmResponseBody;
    log.debug('llm proxy response', {
      finished: data.finished,
      toolCalls: data.toolCalls?.length ?? 0,
    });
    if (data.finished) {
      return { toolCalls: null, finished: true };
    }
    return { toolCalls: data.toolCalls ?? [], finished: false };
  }
}

/**
 * A scripted {@link LlmProvider} for tests and bootstrap. The host supplies a
 * queue of turn outputs; the provider returns them in order. When the queue
 * is exhausted, it returns FINISHED.
 *
 * This is not a production provider; it exists so the agent loop can be tested
 * in isolation without a running backend, per the
 * [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction)
 * (the backend is the production path).
 */
export class ScriptedLlmProvider implements LlmProvider {
  private readonly outputs: TurnOutput[];
  private cursor = 0;

  constructor(outputs: TurnOutput[]) {
    this.outputs = outputs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async turn(_request: LlmTurnRequest): Promise<TurnOutput> {
    if (this.cursor >= this.outputs.length) {
      return { toolCalls: null, finished: true };
    }
    return this.outputs[this.cursor++] ?? { toolCalls: null, finished: true };
  }
}
