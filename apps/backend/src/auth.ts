/**
 * Access and authentication: secret-for-token exchange, tiered token issuance,
 * and token validation middleware.
 *
 * @see specs/usage-and-deployment.spec.md#access-and-authentication
 */

import { Hono, type Context } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import type { BackendConfig, Tier } from './config.js';

/** A signed token: HMAC-signed JSON payload. */
export interface TokenPayload {
  tier: Tier;
  sessionId: string;
  exp: number;
}

/** The response from `/auth/exchange`. */
export interface ExchangeResponse {
  token: string;
  tier: Tier;
  expiresAt: number;
}

const exchangeSchema = z.object({ secret: z.string().optional() });

/** Encode a token payload as an HMAC-signed base64 string. */
function signToken(payload: TokenPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Verify and decode a token; returns null if invalid or expired. */
export function verifyToken(token: string, secret: string): TokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const bodyBytes = Buffer.from(mac, 'base64url');
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (bodyBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(bodyBytes, expectedBytes)) return null;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Generate a random session id. */
function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Create the auth sub-app, exposing `/exchange`.
 */
export function createAuthApp(config: BackendConfig): Hono {
  const app = new Hono();

  app.post('/exchange', async (c) => {
    const body = exchangeSchema.parse(await c.req.json().catch(() => ({})));
    let tier: Tier = 'anonymous';
    if (body.secret) {
      const record = config.secrets.find((s) => s.secret === body.secret);
      if (record) tier = record.tier;
      else return c.json({ error: 'invalid secret' }, 401);
    }
    const now = Date.now();
    const payload: TokenPayload = {
      tier,
      sessionId: newSessionId(),
      exp: now + config.tokenTtlMs,
    };
    const token = signToken(payload, config.tokenSecret);
    const response: ExchangeResponse = {
      token,
      tier,
      expiresAt: payload.exp,
    };
    return c.json(response);
  });

  return app;
}

/** Hono middleware that validates the bearer token and attaches tier/sessionId. */
export function authMiddleware(config: BackendConfig) {
  return async (c: Context, next: () => Promise<void>) => {
    // Skip auth for the exchange endpoint.
    if (c.req.path.startsWith('/auth/')) {
      await next();
      return;
    }
    const header = c.req.header('authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/);
    if (!match) return c.json({ error: 'missing bearer token' }, 401);
    const token = match[1];
    if (!token) return c.json({ error: 'missing bearer token' }, 401);
    const payload = verifyToken(token, config.tokenSecret);
    if (!payload) return c.json({ error: 'invalid or expired token' }, 401);
    c.set('tier', payload.tier);
    c.set('sessionId', payload.sessionId);
    await next();
  };
}
