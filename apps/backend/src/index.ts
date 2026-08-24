/**
 * The backend app: Hono app assembly and server entry.
 *
 * @see specs/usage-and-deployment.spec.md
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { OpenRouterLlmProvider } from '@darkling/guide';

import { loadConfig, type BackendConfig, type Tier } from './config.js';
import { createAuthApp, authMiddleware } from './auth.js';
import { createLlmProxy } from './llm-proxy.js';
import { createRetrievalApp } from './retrieval.js';
import { PersistentStore } from './store.js';
import { UsageStore, enforceCostControls } from './cost-controls.js';
import { FilesystemContentSource, compileIntoStore } from './compile.js';

export interface AppContext {
  Variables: {
    tier: Tier;
    sessionId: string;
  };
}

/** Create the Hono app, wiring all sub-apps and middleware. */
export function createApp(config: BackendConfig): {
  app: Hono<AppContext>;
  store: PersistentStore;
  usage: UsageStore;
} {
  const store = new PersistentStore();
  const usage = new UsageStore();

  const provider = new OpenRouterLlmProvider({
    apiKey: config.llmApiKey,
    model: config.llmModel,
    endpoint: config.llmEndpoint,
  });

  const app = new Hono<AppContext>();

  // Auth middleware on all routes (skips /auth/* internally).
  app.use('*', authMiddleware(config));

  // Auth.
  app.route('/auth', createAuthApp(config));

  // LLM proxy with cost-controls enforcement on /llm/turn (on the parent app,
  // where the auth context's tier/sessionId are established).
  app.use('/llm/turn', async (c, next) => {
    const tier = c.get('tier') as Tier;
    const sessionId = c.get('sessionId') as string;
    const verdict = enforceCostControls(usage, config, tier, sessionId);
    if (!verdict.ok) {
      if (verdict.reason === 'spend-cap') {
        return c.json({ error: 'spend-cap-reached', spend: verdict.spend, cap: verdict.cap }, 402);
      }
      return c.json({ error: 'rate-limited', limit: verdict.limit }, 429);
    }
    await next();
  });
  app.route('/llm', createLlmProxy(provider));

  // Retrieval (not rate-limited/capped).
  app.route('/retrieval', createRetrievalApp(store));

  // Compilation webhook.
  app.post('/webhook/compile', async (c) => {
    try {
      const source = new FilesystemContentSource(config.contentSourcePath);
      await compileIntoStore(source, store);
      return c.body(null, 204);
    } catch (error) {
      return c.json(
        {
          error: 'compilation-failed',
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  return { app, store, usage };
}

/** Run the server (entry point for `start`/`dev`). */
export async function main(): Promise<void> {
  const config = loadConfig();
  const { app, store } = createApp(config);

  // Attempt an initial compilation at startup if the content source exists.
  try {
    const source = new FilesystemContentSource(config.contentSourcePath);
    await compileIntoStore(source, store);
    console.log(`Initial compilation complete: ${config.contentSourcePath}`);
  } catch (error) {
    console.warn(
      `Initial compilation failed (${config.contentSourcePath}): ${error instanceof Error ? error.message : error}`,
    );
  }

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Backend listening on http://localhost:${info.port}`);
  });
}

// Run only when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
