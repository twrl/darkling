/**
 * The LLM proxy: the `/llm/turn` endpoint that forwards the Guide's
 * constrained-agent turn request to the configured `LlmProvider`, holding the
 * API key server-side.
 *
 * @see specs/usage-and-deployment.spec.md#llm-proxy
 */

import { Hono } from 'hono';
import type {
  LlmProvider,
  HttpLlmRequestBody,
  HttpLlmResponseBody,
  LlmTurnRequest,
} from '@darkling/guide';

import type { Tier } from './config.js';

/** Context carried through the LLM proxy (from auth + cost-controls middleware). */
export interface LlmProxyContext {
  /** The Visitor's access tier. */
  tier: Tier;
  /** The session id (from the token). */
  sessionId: string;
  /** The variable name Hono binds the context to. */
  Variables: {
    tier: Tier;
    sessionId: string;
  };
}

/**
 * Create the LLM proxy Hono sub-app. Forwards `/turn` requests to the given
 * provider, which holds the API key server-side.
 */
export function createLlmProxy(provider: LlmProvider): Hono<LlmProxyContext> {
  const app = new Hono<LlmProxyContext>();

  app.post('/turn', async (c) => {
    const body = (await c.req.json()) as HttpLlmRequestBody;
    const request: LlmTurnRequest = {
      input: body.input,
      tools: body.tools as unknown as LlmTurnRequest['tools'],
      previousResults: body.previousResults,
    };
    const output = await provider.turn(request);
    const response: HttpLlmResponseBody = {
      toolCalls: output.toolCalls,
      finished: output.finished,
    };
    return c.json(response);
  });

  return app;
}
