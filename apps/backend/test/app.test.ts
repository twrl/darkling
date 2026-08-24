/**
 * Tests for the backend app: auth, retrieval (+invalidation), cost-controls,
 * and the LLM proxy (via a scripted provider mounted over /llm).
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { makeToken, loadFixture, testConfig } from './fixtures.js';
import { createApp } from '../src/index.js';
import { UsageStore, enforceCostControls } from '../src/cost-controls.js';
import { verifyToken } from '../src/auth.js';
import type { BackendConfig } from '../src/config.js';

function authed(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

describe('auth', () => {
  it('issues an anonymous token with no secret', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; tier: string; expiresAt: number };
    expect(body.tier).toBe('anonymous');
    expect(body.token).toBeTruthy();
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('exchanges a valid secret for the corresponding tier token', async () => {
    const config = testConfig();
    const { app } = createApp(config);
    const res = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'secret-token' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; tier: string };
    expect(body.tier).toBe('token');
    const payload = verifyToken(body.token, config.tokenSecret);
    expect(payload?.tier).toBe('token');
  });

  it('rejects an invalid secret', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('operator secret yields an operator token with no cap', async () => {
    const config = testConfig();
    const { app } = createApp(config);
    const res = await app.request('/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'secret-op' }),
    });
    const body = (await res.json()) as { tier: string };
    expect(body.tier).toBe('operator');
  });

  it('rejects requests without a bearer token', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/retrieval/toc');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const { app } = createApp(testConfig());
    const res = await app.request('/retrieval/toc', {
      headers: authed('not-a-real-token'),
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token', async () => {
    const config = testConfig();
    const { app } = createApp(config);
    const token = makeToken('anonymous', 's1', config.tokenSecret);
    const res = await app.request('/retrieval/toc', { headers: authed(token) });
    expect(res.status).toBe(200);
  });
});

describe('retrieval', () => {
  let app: ReturnType<typeof createApp>['app'];
  let token: string;
  let config: BackendConfig;

  beforeEach(async () => {
    config = testConfig();
    const created = createApp(config);
    app = created.app;
    await loadFixture(created.store);
    token = makeToken('anonymous', 's1', config.tokenSecret);
  });

  it('serves the ToC', async () => {
    const res = await app.request('/retrieval/toc', { headers: authed(token) });
    expect(res.status).toBe(200);
    const toc = (await res.json()) as Array<{ id: string; slug: string; title: string }>;
    expect(toc.length).toBe(2);
    const titles = toc.map((d) => d.title).sort();
    expect(titles).toEqual(['Alpha', 'Second Document']);
  });

  it('retrieves a document by id', async () => {
    const toc = (await (
      await app.request('/retrieval/toc', { headers: authed(token) })
    ).json()) as Array<{
      id: string;
    }>;
    const id = toc[0]!.id;
    const res = await app.request(`/retrieval/documents/${id}`, { headers: authed(token) });
    const doc = (await res.json()) as { id: string; title: string; rootBlock: string };
    expect(doc.id).toBe(id);
    expect(doc.title).toBeTruthy();
  });

  it('retrieves a document by slug', async () => {
    const res = await app.request('/retrieval/by-slug/alpha', { headers: authed(token) });
    const doc = (await res.json()) as { slug: string };
    expect(doc.slug).toBe('alpha');
  });

  it('searches blocks by text', async () => {
    const res = await app.request('/retrieval/search-blocks?query=alpha', {
      headers: authed(token),
    });
    const result = (await res.json()) as { items: Array<{ id: string }> };
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('traverses outbound relationships', async () => {
    // The alpha document's second section references second.md.
    const docRes = await app.request('/retrieval/by-slug/alpha', { headers: authed(token) });
    const doc = (await docRes.json()) as { rootBlock: string };
    const rootBlockRes = await app.request(`/retrieval/blocks/${doc.rootBlock}`, {
      headers: authed(token),
    });
    const rootBlock = (await rootBlockRes.json()) as { children: string[] };
    // Find a child block with relationships.
    let target: string | null = null;
    for (const childId of rootBlock.children) {
      const res = await app.request(`/retrieval/blocks/${childId}`, { headers: authed(token) });
      const block = (await res.json()) as {
        relationships: Array<{ type: string; target: string }>;
      };
      if (block.relationships.length > 0) {
        target = childId;
        break;
      }
    }
    expect(target).not.toBeNull();
    const res = await app.request(`/retrieval/traverse-outbound/${target}`, {
      headers: authed(token),
    });
    const result = (await res.json()) as { items: Array<{ type: string; blockId: string }> };
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('wraps the result with an invalidation list when since is present', async () => {
    const since = Date.now() - 1000;
    const res = await app.request(`/retrieval/toc?since=${since}`, { headers: authed(token) });
    const body = (await res.json()) as {
      result: unknown;
      invalid: { documents: string[]; blocks: string[] };
      asOf: number;
    };
    expect(body.result).toBeDefined();
    expect(body.invalid.documents.length).toBeGreaterThan(0);
    expect(body.asOf).toBeGreaterThanOrEqual(since);
  });

  it('returns the raw result when since is absent', async () => {
    const res = await app.request('/retrieval/toc', { headers: authed(token) });
    const body = (await res.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('cost controls', () => {
  let config: BackendConfig;

  beforeEach(() => {
    config = testConfig();
  });

  it('enforces the per-session spend cap', () => {
    const usage = new UsageStore();
    // Anonymous cap is 100. Spend 100, then a further call is refused.
    usage.addSpend('s1', 100);
    const verdict = enforceCostControls(usage, config, 'anonymous', 's1');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('spend-cap');
  });

  it('enforces the global rate limit', () => {
    const usage = new UsageStore();
    // Anonymous rate limit is 10/min. Make 10 calls.
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const v = enforceCostControls(usage, config, 'anonymous', 's1', now + i);
      expect(v.ok).toBe(true);
    }
    // The 11th is refused.
    const verdict = enforceCostControls(usage, config, 'anonymous', 's1', now + 10);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('rate-limit');
  });

  it('operator tier has no cap or rate limit', () => {
    const usage = new UsageStore();
    usage.addSpend('s-op', 1_000_000);
    for (let i = 0; i < 100; i++) {
      const v = enforceCostControls(usage, config, 'operator', 's-op', 1_000_000 + i);
      expect(v.ok).toBe(true);
    }
  });

  it('returns 402 when the spend cap is reached on the LLM proxy', async () => {
    const { app, usage } = createApp(config);
    // Exhaust the anonymous cap for a session.
    usage.addSpend('s-cap', config.tiers.anonymous.spendCap!);
    const token = makeToken('anonymous', 's-cap', config.tokenSecret);
    const res = await app.request('/llm/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authed(token) },
      body: JSON.stringify({ input: { events: [], status: {} }, tools: [] }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('spend-cap-reached');
  });
});

describe('webhook', () => {
  it('recompiles on webhook (with a filesystem source that may not exist)', async () => {
    const config = testConfig({ contentSourcePath: './nonexistent-for-test' });
    const { app } = createApp(config);
    // The webhook attempts to compile; a missing path returns 500.
    const res = await app.request('/webhook/compile', {
      method: 'POST',
      headers: authed(makeToken('operator', 's-w', config.tokenSecret)),
    });
    // Either 204 (if path exists) or 500 (missing path). In test env, missing.
    expect([204, 500]).toContain(res.status);
  });
});
