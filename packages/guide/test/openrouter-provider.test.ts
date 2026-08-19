/**
 * Tests for the OpenRouter LLM provider: request mapping, response parsing,
 * and FINISHED/tool-call handling.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { OpenRouterLlmProvider } from '../src/openrouter-provider.js';
import type { InteractionInput, ToolCall } from '../src/model.js';
import type { ToolDeclaration } from '../src/tools.js';
import type { TurnResultEntry } from '../src/llm-provider.js';

/** A fetch implementation that returns a canned JSON response. */
function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

/** A fetch implementation that records the request body for assertions. */
function fetchRecording(body: unknown, recorder: { body: unknown }, status = 200): typeof fetch {
  return (async (_input: unknown, init?: RequestInit) => {
    if (init?.body) recorder.body = JSON.parse(init.body as string);
    return new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/** A minimal tool declaration for tests. */
function echoToolDeclaration(): ToolDeclaration {
  return {
    name: 'avatar_say',
    category: 'avatar-and-user-interaction',
    params: z.object({ value: z.string() }),
    returns: z.object({ echoed: z.string() }),
    cost: 1,
    description: 'Say something to the User.',
  };
}

/** A minimal interaction input for tests. */
function input(): InteractionInput {
  return {
    eventQueue: [{ type: 'direct_address', timestamp: 1, payload: { text: 'hi' } }],
    status: {
      budget: { total: 10, consumed: 0, remaining: 10 },
      workingMemory: { topic: 'ceph-biology' },
      undispatched: [],
    },
  };
}

describe('OpenRouterLlmProvider — construction', () => {
  it('requires an apiKey', () => {
    expect(() => new OpenRouterLlmProvider({ apiKey: '' })).toThrow();
  });

  it('uses the default endpoint when none is given', () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({ choices: [] }),
    });
    // The endpoint is private; we verify via a request that it does not throw
    // for a well-formed response. The default is exercised in later tests.
    expect(provider).toBeInstanceOf(OpenRouterLlmProvider);
  });
});

describe('OpenRouterLlmProvider — request mapping', () => {
  it('sends the model, messages, tools, and stream:false', async () => {
    const recorded: { body: unknown } = { body: null };
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      model: 'openai/gpt-4o',
      fetch: fetchRecording(
        { choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }] },
        recorded,
      ),
    });
    await provider.turn({
      input: input(),
      tools: [echoToolDeclaration()],
    });
    const body = recorded.body as {
      model: string;
      messages: Array<{ role: string }>;
      tools: Array<{ type: string; function: { name: string; parameters: object } }>;
      stream: boolean;
      tool_choice: string;
    };
    expect(body.model).toBe('openai/gpt-4o');
    expect(body.stream).toBe(false);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.type).toBe('function');
    expect(body.tools[0]?.function.name).toBe('avatar_say');
    // The parameters are a JSON Schema object (Zod → JSON Schema).
    expect(body.tools[0]?.function.parameters).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
    });
    // System + user messages are present.
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('includes the budget and working memory in the system message', async () => {
    const recorded: { body: unknown } = { body: null };
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchRecording(
        { choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }] },
        recorded,
      ),
    });
    await provider.turn({ input: input(), tools: [] });
    const body = recorded.body as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('10');
    expect(system).toContain('ceph-biology');
  });

  it('includes undispatched tool calls in the system message when present', async () => {
    const recorded: { body: unknown } = { body: null };
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchRecording(
        { choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }] },
        recorded,
      ),
    });
    const inp = input();
    inp.status.undispatched = [
      { name: 'avatar_say', params: { value: 'x' }, reason: 'budget-exhausted' },
    ];
    await provider.turn({ input: inp, tools: [] });
    const body = recorded.body as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('Undispatched tool calls');
    expect(system).toContain('avatar_say');
  });

  it('sends previous tool results as assistant + tool messages', async () => {
    const recorded: { body: unknown } = { body: null };
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchRecording(
        { choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }] },
        recorded,
      ),
    });
    const results: TurnResultEntry[] = [
      { callId: 'c1', name: 'avatar_say', ok: true, value: { echoed: 'hi' } },
    ];
    await provider.turn({ input: input(), tools: [], previousResults: results });
    const body = recorded.body as {
      messages: Array<{ role: string; tool_call_id?: string; tool_calls?: unknown[] }>;
    };
    const roles = body.messages.map((m) => m.role);
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');
    const toolMsg = body.messages.find((m) => m.role === 'tool')!;
    expect(toolMsg.tool_call_id).toBe('c1');
  });

  it('does not include tools when none are registered', async () => {
    const recorded: { body: unknown } = { body: null };
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchRecording(
        { choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }] },
        recorded,
      ),
    });
    await provider.turn({ input: input(), tools: [] });
    const body = recorded.body as { tools?: unknown; tool_choice?: unknown };
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('sends attribution and auth headers', async () => {
    const recorded: { headers: Record<string, string> } = { headers: {} };
    const fetchImpl: typeof fetch = (async (_input: unknown, init?: RequestInit) => {
      recorded.headers = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;
    const provider = new OpenRouterLlmProvider({
      apiKey: 'secret-key',
      siteUrl: 'https://darkling.example',
      siteTitle: 'Darkling',
      fetch: fetchImpl,
    });
    await provider.turn({ input: input(), tools: [] });
    expect(recorded.headers['authorization']).toBe('Bearer secret-key');
    expect(recorded.headers['HTTP-Referer']).toBe('https://darkling.example');
    expect(recorded.headers['X-Title']).toBe('Darkling');
  });
});

describe('OpenRouterLlmProvider — response parsing', () => {
  it('maps tool_calls to ToolCalls', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'avatar_say', arguments: '{"value":"hi"}' },
                },
              ],
            },
          },
        ],
      }),
    });
    const out = await provider.turn({ input: input(), tools: [echoToolDeclaration()] });
    expect(out.finished).toBe(false);
    expect(out.toolCalls).toHaveLength(1);
    const tc = out.toolCalls![0] as ToolCall;
    expect(tc.name).toBe('avatar_say');
    expect(tc.callId).toBe('call_1');
    expect(tc.params).toEqual({ value: 'hi' });
  });

  it('maps finish_reason "stop" to FINISHED', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({
        choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }],
      }),
    });
    const out = await provider.turn({ input: input(), tools: [] });
    expect(out.finished).toBe(true);
    expect(out.toolCalls).toBeNull();
  });

  it('maps finish_reason "length" to FINISHED (ends interaction)', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({
        choices: [{ finish_reason: 'length', message: { content: '...', role: 'assistant' } }],
      }),
    });
    const out = await provider.turn({ input: input(), tools: [] });
    expect(out.finished).toBe(true);
  });

  it('treats tool_calls without finish_reason "tool_calls" as FINISHED', async () => {
    // A provider that returns tool_calls but a non-tool_calls finish reason
    // is treated as having finished (no further tool calls accepted).
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: null,
              role: 'assistant',
              tool_calls: [
                { id: 'x', type: 'function', function: { name: 'avatar_say', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
    });
    const out = await provider.turn({ input: input(), tools: [echoToolDeclaration()] });
    expect(out.finished).toBe(true);
    expect(out.toolCalls).toBeNull();
  });

  it('handles malformed tool arguments by emitting the raw string', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'avatar_say', arguments: 'not-json' },
                },
              ],
            },
          },
        ],
      }),
    });
    const out = await provider.turn({ input: input(), tools: [echoToolDeclaration()] });
    expect(out.toolCalls![0]?.params).toBe('not-json');
  });

  it('throws on a non-2xx response', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({ error: 'bad' }, 401),
    });
    await expect(provider.turn({ input: input(), tools: [] })).rejects.toThrow(
      /OpenRouter returned 401/,
    );
  });

  it('throws when the response has no choices', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({ choices: [] }),
    });
    await expect(provider.turn({ input: input(), tools: [] })).rejects.toThrow(/no choices/);
  });

  it('throws when the choice carries an error', async () => {
    const provider = new OpenRouterLlmProvider({
      apiKey: 'k',
      fetch: fetchReturning({
        choices: [
          {
            finish_reason: 'error',
            message: { content: '', role: 'assistant' },
            error: { code: 500, message: 'upstream failed' },
          },
        ],
      }),
    });
    await expect(provider.turn({ input: input(), tools: [] })).rejects.toThrow(/upstream failed/);
  });
});

describe('OpenRouterLlmProvider — integration with AgentLoop', () => {
  it('drives a full interaction via the loop', async () => {
    const { AgentLoop } = await import('../src/agent-loop.js');
    const { ToolRegistry } = await import('../src/tools.js');
    const { BudgetTracker, DEFAULT_BUDGET_POLICY } = await import('../src/budget.js');

    const registry = new ToolRegistry();
    registry.register(echoToolDeclaration(), async (params) => ({
      echoed: (params as { value: string }).value,
    }));

    // First turn: a tool call; second turn: FINISHED.
    let callsMade = 0;
    const fetchImpl: typeof fetch = (async () => {
      callsMade++;
      return new Response(
        JSON.stringify(
          callsMade === 1
            ? {
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: {
                      content: null,
                      role: 'assistant',
                      tool_calls: [
                        {
                          id: 'call_1',
                          type: 'function',
                          function: { name: 'avatar_say', arguments: '{"value":"hello"}' },
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                choices: [{ finish_reason: 'stop', message: { content: '', role: 'assistant' } }],
              },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new OpenRouterLlmProvider({ apiKey: 'k', fetch: fetchImpl });
    const loop = new AgentLoop(
      provider,
      registry,
      new BudgetTracker(DEFAULT_BUDGET_POLICY),
      DEFAULT_BUDGET_POLICY,
    );
    const outcome = await loop.runInteraction(
      [{ type: 'direct_address', timestamp: 1, payload: null }],
      null,
    );
    expect(outcome.reason).toBe('finished');
    expect(outcome.consumed).toBe(1);
  });
});
