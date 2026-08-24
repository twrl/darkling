/**
 * Test fixtures for the backend: a tiny content source and compiled model,
 * plus a test config and a ScriptedLlmProvider-backed app factory.
 */

import { StaticContentSource, compile } from '@darkling/knowledge-base/compiler';
import { createHmac } from 'node:crypto';

import { loadConfig, type BackendConfig } from '../src/config.js';
import { createApp } from '../src/index.js';
import type { PersistentStore } from '../src/store.js';

/** A minimal two-document content source for tests. */
const SOURCE = new StaticContentSource({
  'alpha.md': `---
title: Alpha
relationships:
  - from: "1.2"
    type: references
    to: "second:1"
---

# Alpha

This is the alpha document.

## First section

Content of the first section.

## Second section

Content of the second section.
`,
  'second.md': `---
title: Second
relationships:
  - from: "1"
    type: describes
    to: "alpha:1"
---

# Second Document

Intro to the second document.
`,
});

/** Compile the test source and return the model. */
export async function compileFixture() {
  return compile(SOURCE);
}

/** A test config with fixed values and a test secret. */
export function testConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  const base = loadConfig({
    LLM_API_KEY: 'test-key',
    TOKEN_SECRET: 'test-token-secret-min-length',
    CONTENT_SOURCE_PATH: './content',
    SECRETS: 'secret-token:token,secret-op:operator',
    ...process.env,
  });
  return { ...base, ...overrides };
}

/** Create an app for testing. The app uses OpenRouterLlmProvider by default;
 * LLM proxy tests exercise the cost-controls path (which rejects before the provider is reached). */
export function createTestApp() {
  const config = testConfig();
  const { app, store } = createApp(config);
  return { app, store, config };
}

/** Load a fixture model into a store. */
export async function loadFixture(store: PersistentStore) {
  const model = await compileFixture();
  store.load(model);
  return model;
}

/** A valid token for a tier, signed with the test secret. */
export function makeToken(
  tier: 'anonymous' | 'token' | 'operator',
  sessionId: string,
  secret = 'test-token-secret-min-length',
): string {
  const payload = {
    tier,
    sessionId,
    exp: Date.now() + 60_000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
