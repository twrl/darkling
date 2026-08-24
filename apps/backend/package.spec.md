# `backend` app

## Purpose and scope

This specification defines the `backend` app: the serverless Hono application that proxies the Guide's LLM calls, owns the compiled content model, serves retrieval queries over HTTP, issues and validates access tokens, and enforces per-session spend caps and global rate limits.

It governs:

- the app's public HTTP API surface — the endpoints the frontend calls and their wire formats;
- the LLM proxy — forwarding the Guide's constrained-agent turn requests to the configured LLM provider, holding the API key server-side;
- the retrieval HTTP API — the endpoints serving the knowledge-base retrieval operations, the table of contents, and the cache-invalidation list;
- the access/auth API — secret-for-token exchange, tiered token issuance, and token validation middleware;
- the cost/abuse controls — per-session spend cap and global rate limit enforcement, tier-dependent;
- the persistent store — the provider-interface implementations backing retrieval, and the compilation that populates the store;
- the conformance of the app to [Usage and deployment](../../specs/usage-and-deployment.spec.md), which remains the normative specification for the backend's responsibilities.

It is explicitly out of scope for this specification to define:

- the normative requirements of the backend's responsibilities — which are defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md);
- the constrained agent's interaction model and tool discipline — which are defined by [Constrained agent](../../specs/constrained-agent.spec.md);
- the content model, retrieval interface, and compilation contract — which are defined by [Content model](../../specs/content-model.spec.md), [Content-first retrieval](../../specs/content-first-retrieval.spec.md), and [Authoring tooling](../../specs/authoring-tooling.spec.md);
- the LLM provider abstraction's interface — which is defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction) and concretized by `@darkling/guide`'s `LlmProvider` / `OpenRouterLlmProvider` / `HttpLlmRequestBody` / `HttpLlmResponseBody`;
- the UI — which is defined by [User interface](../../specs/ui.spec.md);
- the specific persistent store technology — which is an implementation concern; the initial implementation uses an in-memory store, swappable for Redis/Upstash via the provider-interface abstraction.

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of the app's conformance to that specification. This specification is an implementation contract: it governs how the app is structured and consumed, not the behavioural requirements of the backend itself.

## Relationship to `specs/usage-and-deployment.spec.md`

[Usage and deployment](../../specs/usage-and-deployment.spec.md) defines the backend's responsibilities (LLM proxy, content compilation and retrieval, access/auth, cost/abuse controls), the runtime topology, and the session model. This specification defines the app that implements those requirements.

The HTTP wire format for retrieval, the ToC, and the cache-invalidation list is **not** defined normatively by any existing specification — [Usage and deployment](../../specs/usage-and-deployment.spec.md#client-side-retrieval-and-caching) explicitly defers the `since`/invalidation-list interface to [Content-first retrieval](../../specs/content-first-retrieval.spec.md), to be established via the specification workflow. This specification defines a wire format as an **implementation decision** (recorded in [package.journal.md](./package.journal.md)), to be ratified by a future refinement of [Content-first retrieval](../../specs/content-first-retrieval.spec.md). If the ratified format differs, the app is updated to conform.

## Public API surface

The app exposes an HTTP API over Hono. All endpoints except token exchange require a valid `Authorization: Bearer <token>` header; token validation and tier/cap enforcement are applied by middleware, as defined in [Access and authentication](#access-and-authentication) and [Cost and abuse controls](#cost-and-abuse-controls).

### LLM proxy

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/llm/turn` | `HttpLlmRequestBody` (from `@darkling/guide`) | `HttpLlmResponseBody` |

Forwards the Guide's constrained-agent turn request to the configured `LlmProvider` (default: `OpenRouterLlmProvider`), holding the API key server-side, as defined by [LLM proxy](../../specs/usage-and-deployment.spec.md#llm-proxy). The wire format is the `HttpLlmRequestBody`/`HttpLlmResponseBody` contract defined by `@darkling/guide`'s `HttpLlmProvider`. The backend applies the cost/abuse controls before forwarding, as defined in [Cost and abuse controls](#cost-and-abuse-controls).

### Retrieval

The retrieval HTTP API mirrors the nine retrieval operations exposed by the `@darkling/knowledge-base` service declaration, plus a ToC endpoint. Each returns the result shape from `@darkling/knowledge-base`'s retrieval types (`DocumentResult`, `BlockResult`, `TraversalResult`, `ByIdResult`, `PageResult`), augmented with a cache-invalidation list when a `since` timestamp is supplied.

| Method | Path | Query / Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/retrieval/documents/:id` | — | `DocumentResult \| null` |
| `GET` | `/retrieval/documents` | `?ids=a,b` | `ByIdResult<DocumentResult>` |
| `GET` | `/retrieval/blocks/:id` | — | `BlockResult \| null` |
| `GET` | `/retrieval/blocks` | `?ids=a,b` | `ByIdResult<BlockResult>` |
| `GET` | `/retrieval/by-slug/:slug` | — | `DocumentResult \| null` |
| `GET` | `/retrieval/query-documents` | `?property=...&value=...&limit=&cursor=` | `PageResult<DocumentResult>` |
| `GET` | `/retrieval/query-blocks` | `?property=...&value=...&limit=&cursor=` | `PageResult<BlockResult>` |
| `GET` | `/retrieval/search-blocks` | `?query=...&limit=&cursor=` | `PageResult<BlockResult>` |
| `GET` | `/retrieval/search-documents` | `?query=...&limit=&cursor=` | `PageResult<DocumentResult>` |
| `GET` | `/retrieval/traverse-outbound/:blockId` | `?typeFilter=&limit=&cursor=` | `PageResult<TraversalResult>` |
| `GET` | `/retrieval/traverse-inbound/:blockId` | `?typeFilter=&limit=&cursor=` | `PageResult<TraversalResult>` |
| `GET` | `/retrieval/toc` | — | `Array<{ id, slug, title }>` |

All retrieval endpoints accept an optional `since` query parameter (a Unix epoch timestamp in milliseconds). When present, the response is wrapped in `{ result: <result>, invalid: { documents: string[], blocks: string[] }, asOf: number }`, where `invalid` lists the IDs of documents and blocks added/modified/removed since `since`, and `asOf` is the timestamp to use as the next `since`. When `since` is absent, the endpoint returns the result shape directly (no invalidation list). This is the `since`/invalidation-list mechanism required by [Usage and deployment](../../specs/usage-and-deployment.spec.md#client-side-retrieval-and-caching); the exact JSON shape is an implementation decision pending ratification by [Content-first retrieval](../../specs/content-first-retrieval.spec.md).

The ToC endpoint returns the document-level index (document IDs, slugs, titles — no block content), as defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md#client-side-retrieval-and-caching).

### Access and authentication

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/auth/exchange` | `{ secret?: string }` | `{ token: string, tier: "anonymous" \| "token" \| "operator", expiresAt: number }` |

Exchanges a presented pre-shared secret for a signed token carrying the secret's tier as a claim, or issues an anonymous token if no secret is presented, as defined by [Access and authentication](../../specs/usage-and-deployment.spec.md#access-and-authentication). Tokens are signed (HMAC) and carry the tier and a session identifier. The specific token format is an implementation concern; the initial implementation uses an HMAC-signed JSON token (a minimal PASETO-like shape).

Token validation middleware validates the `Authorization: Bearer <token>` header on every non-`/auth` request, rejects invalid/expired tokens, and attaches the tier and session id to the request context for cap/rate-limit enforcement.

### Compilation webhook

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/webhook/compile` | (implementation-defined) | `204 No Content` |

Triggers recompilation of the content source into the persistent store, as defined by [Content lifecycle](../../specs/usage-and-deployment.spec.md#content-lifecycle). The webhook payload format and file-mapping is an implementation concern. The initial implementation recompiles the entire content source on each webhook (no incremental file-mapping).

## Persistent store

The retrieval endpoints are backed by provider-interface implementations of `@darkling/knowledge-base`'s `BlockStore`, `PropertyIndex`, `TextIndex`, `RelationshipIndex`, and `ContainmentIndex`, composed by a `RetrievalEngine`. The initial implementation provides in-memory implementations (reusing `@darkling/knowledge-base`'s `createInMemoryStores`), swappable for Redis/Upstash-backed implementations via the provider-interface abstraction. The store is populated by compilation, as defined in [Compilation](#compilation).

A `CompiledModel` is loaded into the stores via the providers' `bulkLoad` method. The in-memory store is a process-local cache of the compiled model; the production Redis-backed store persists across invocations.

## Compilation

The backend compiles source Markdown into a `CompiledModel` using `@darkling/knowledge-base`'s compiler, against a `ContentSource` (the initial implementation uses a filesystem `ContentSource` rooted at a configured directory). Compilation conforms to the compilation contract defined by [Content model](../../specs/content-model.spec.md#compilation-contract). The compiled model is loaded into the persistent store via `bulkLoad`. Recompilation is triggered by the webhook, as defined in [Compilation webhook](#compilation-webhook).

## Cost and abuse controls

The backend enforces per-session spend caps and global rate limits, tier-dependent, as defined by [Cost and abuse controls](../../specs/usage-and-deployment.spec.md#cost-and-abuse-controls).

- **Spend cap.** The LLM proxy tracks per-session spend (the cumulative cost of dispatched tool calls in a session, keyed by the session id from the token). When a session's spend reaches its tier's cap, the proxy refuses further LLM calls for that session with a `402 Payment Required` and a body indicating the cap is reached (the frontend renders the in-world rest message, as defined by [User interface](../../specs/ui.spec.md#cap-enforcement)).
- **Rate limit.** The proxy enforces a global rate limit on LLM calls per tier (a sliding-window count). When the limit is reached, the proxy refuses the call with `429 Too Many Requests`.
- **Tier values.** The cap and rate-limit values per tier are configuration (policy parameters), resolved at startup, as defined by [Policy and configuration](../../specs/policy-and-configuration.spec.md). The operator tier has no cap and no rate limit.
- **Usage tracking.** Spend and rate counters are held in a usage-tracking store (the initial implementation is in-memory, keyed by session id; the production implementation uses Redis). Counters are discarded when the session ends.

The cost/abuse controls are enforced only on the LLM proxy path (the retrieval and auth paths are not rate-limited or capped).

## Structural contract

The app is organised into the following modules:

- `src/index.ts` — the Hono app assembly and server entry.
- `src/llm-proxy.ts` — the `/llm/turn` endpoint, forwarding to the configured `LlmProvider`.
- `src/auth.ts` — the `/auth/exchange` endpoint, token issuance/validation, and the auth middleware.
- `src/cost-controls.ts` — the spend-cap and rate-limit enforcement and the usage-tracking store.
- `src/retrieval.ts` — the retrieval HTTP endpoints, the ToC endpoint, and the `since`/invalidation-list wrapping.
- `src/store.ts` — the persistent-store provider-interface implementations (in-memory initial; Redis-swappable).
- `src/compile.ts` — the compilation pipeline and webhook handler.
- `src/config.ts` — configuration resolution (LLM provider, API key, content source path, tier cap/rate values, HMAC secret).

## Dependencies

The app depends on:

- `hono` — the HTTP framework.
- `zod` (v4) — request/response validation.
- `@darkling/guide` (workspace) — the LLM provider abstraction (`LlmProvider`, `OpenRouterLlmProvider`, `HttpLlmRequestBody`, `HttpLlmResponseBody`).
- `@darkling/knowledge-base` (workspace) — the provider interfaces, `RetrievalEngine`, the compiler, and the in-memory stores.
- `@darkling/service-bus` (workspace) — shared types (transitively).

## Conformance

The app conforms to [Usage and deployment](../../specs/usage-and-deployment.spec.md):

- it proxies LLM calls through the configured provider, holding the API key server-side, as defined by [LLM proxy](../../specs/usage-and-deployment.spec.md#llm-proxy);
- it serves retrieval from the persistent store over HTTP, returning the `@darkling/knowledge-base` result shapes, as defined by [Backend responsibilities](../../specs/usage-and-deployment.spec.md#backend-responsibilities);
- it compiles source Markdown into the persistent store on webhook, as defined by [Content lifecycle](../../specs/usage-and-deployment.spec.md#content-lifecycle);
- it issues and validates tiered tokens via secret exchange, with no logon UI, as defined by [Access and authentication](../../specs/usage-and-deployment.spec.md#access-and-authentication);
- it enforces per-session spend caps and global rate limits per tier, as defined by [Cost and abuse controls](../../specs/usage-and-deployment.spec.md#cost-and-abuse-controls);
- it is stateless per-invocation (the in-memory initial store is a process-local cache pending the Redis-backed production store), as defined by [Deployment shape](../../specs/usage-and-deployment.spec.md#deployment-shape).