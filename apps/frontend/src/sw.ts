/**
 * The Service Worker for transparent token handling.
 *
 * Intercepts fetch requests destined for the backend (LLM proxy and
 * retrieval), attaches `Authorization: Bearer <token>` headers, and manages
 * the token lifecycle (exchange, refresh, expiry). The token is not visible
 * to the page and is not carried in a cookie.
 *
 * @see specs/ui.spec.md#service-worker
 * @see specs/usage-and-deployment.spec.md#access-and-authentication
 */

/// <reference lib="webworker" />

/** Cast self to the ServiceWorkerGlobalScope type (the DOM lib types self as Window). */
const sw = self as unknown as ServiceWorkerGlobalScope;

/** The backend base URL (configurable via env at build time, or derived). */
const BACKEND_BASE =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL ?? '';

/** The stored token and its expiry. */
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Whether a token fetch is in flight (to deduplicate concurrent requests). */
let tokenFetchPromise: Promise<string | null> | null = null;

/** A secret extracted from the page URL on first load (if present). */
let pendingSecret: string | null = null;

/** Determine whether a request URL is destined for the backend. */
function isBackendRequest(url: string): boolean {
  if (!BACKEND_BASE) {
    return (
      url.includes('/llm/') ||
      url.includes('/retrieval/') ||
      url.includes('/auth/') ||
      url.includes('/webhook/')
    );
  }
  return url.startsWith(BACKEND_BASE);
}

/** Determine whether a request is the token-exchange endpoint (no auth needed). */
function isAuthExchangeRequest(url: string): boolean {
  return url.includes('/auth/exchange');
}

/** Get a valid token, exchanging/refreshing as needed. */
async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 30_000) {
    return cachedToken;
  }
  if (tokenFetchPromise) {
    return tokenFetchPromise;
  }
  tokenFetchPromise = fetchToken();
  try {
    return await tokenFetchPromise;
  } finally {
    tokenFetchPromise = null;
  }
}

/** Exchange for a token (anonymous if no secret, or with a pre-extracted secret). */
async function fetchToken(): Promise<string | null> {
  try {
    const secret = pendingSecret ?? undefined;
    if (secret) pendingSecret = null; // Single-use.

    const exchangeUrl = BACKEND_BASE ? `${BACKEND_BASE}/auth/exchange` : '/auth/exchange';
    const res = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { token: string; expiresAt: number };
    cachedToken = body.token;
    tokenExpiresAt = body.expiresAt;
    return cachedToken;
  } catch {
    return null;
  }
}

/** Extract a secret from the page URL on first load, if present. */
async function extractSecret(): Promise<void> {
  const clients = await sw.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    const url = new URL(client.url);
    const secret = url.searchParams.get('secret');
    if (secret) {
      pendingSecret = secret;
      // Clean the secret from the URL so it's not visible in history.
      url.searchParams.delete('secret');
      await sw.clients.claim();
      // Navigate the client to the cleaned URL.
      (client as unknown as { navigate: (url: string) => Promise<void> })
        .navigate(url.toString())
        .catch(() => {});
    }
  }
}

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim().then(() => extractSecret()));
});

sw.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request;
  const url = request.url;

  if (!isBackendRequest(url) || isAuthExchangeRequest(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const token = await getToken();
      const headers = new Headers(request.headers);
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      try {
        return await fetch(request, { headers });
      } catch {
        return new Response('Backend unavailable', { status: 503 });
      }
    })(),
  );
});
