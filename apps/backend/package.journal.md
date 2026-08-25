# `backend` app — journal

## Creation

Created as the backend application implementation, replacing the boilerplate Hono app. The backend is the serverless component defined by `usage-and-deployment.spec.md`: it proxies the LLM, owns the compiled content model and serves retrieval, issues/validates tokens, and enforces cost/abuse controls.

The existing backend was a generic Hono boilerplate (`app.get('/')` returning a welcome string); per the user it did not need preserving. The tsconfig was retargeted to extend the repo's `@repo/typescript-config/base.json` (matching the package pattern), and an eslint config was added.

## Decisions

### Build all, ratify later (HTTP wire format)

The retrieval HTTP wire format (endpoint paths, the `since`/invalidation-list JSON, the ToC shape) is normatively required by `usage-and-deployment.spec.md` but not specified — it explicitly defers the `since`/invalidation-list to `content-first-retrieval.spec.md` "to be established via the specification workflow." Per the user's decision ("build all, ratify later"), this app defines a sensible wire format as an implementation decision, to be ratified by a future refinement of `content-first-retrieval.spec.md`. Recorded in `package.spec.md`; if the ratified format differs, the app is updated.

The chosen format:

- **Retrieval endpoints** mirror the nine `@darkling/knowledge-base` service-declaration functions, as GET endpoints with path/query params (documents/blocks by id, by-slug, query-_, search-_, traverse-*). Result shapes are the `@darkling/knowledge-base` retrieval types verbatim.
- **`since` invalidation list.** A `since` query param (epoch ms); when present, the response wraps the result in `{ result, invalid: { documents: string[], blocks: string[] }, asOf: number }`. When absent, the raw result shape. This is a straightforward JSON encoding of the semantic shape `usage-and-deployment` describes ("a list of IDs … added, modified, or removed since that timestamp").
- **ToC.** `GET /retrieval/toc` returning `Array<{ id, slug, title }>`. Minimal; matches the normative content (IDs, slugs, titles, no block content).
- **Cursor.** Passed as a `cursor` query param; opaque to the Guide. The engine (frontend-side) produces/consumes it; the backend passes it through. The backend providers return unpaginated sets and the frontend engine paginates, per the research — so the backend endpoints that back the provider methods return complete sets, and the `cursor`/`limit` params are accepted but pagination is applied by the frontend engine. (Scalability caveat noted below.)

### In-memory store first, Redis later

Per the user ("in-memory first, Redis later"), the initial persistent-store implementations are in-memory, reusing `@darkling/knowledge-base`'s `createInMemoryStores`. The store is swappable for Redis/Upstash via the provider-interface abstraction (`BlockStore`, `PropertyIndex`, `TextIndex`, `RelationshipIndex`, `ContainmentIndex`). The in-memory store is a process-local cache of the compiled model (acceptable for dev; the production Redis-backed store persists across invocations, as the spec requires "stateless per-invocation" backed by a persistent store).

This is recorded as a deviation from the spec's "stateless per-invocation" requirement for the dev case (the in-memory store is lost on restart). Acceptable for initial development; the Redis swap restores conformance.

### LLM proxy wire format

The `/llm/turn` endpoint uses the exact `HttpLlmRequestBody`/`HttpLlmResponseBody` contract defined by `@darkling/guide`'s `HttpLlmProvider` — no invention, the contract already exists. The backend instantiates `OpenRouterLlmProvider` (from `@darkling/guide`) with the server-side API key and forwards. This reuses the existing provider implementation rather than re-implementing the OpenRouter mapping.

### Token format: HMAC-signed JSON (minimal PASETO-like)

The spec says "PASETO or JWT" and leaves the format as an implementation concern. The initial implementation uses an HMAC-signed JSON token (`{ tier, sessionId, exp }` + HMAC), which is a minimal PASETO-like shape. This avoids a JWT/PASETO library dependency for the initial implementation. Swappable for a standard PASETO/JWT library later.

### Cost controls on the LLM path only

Per the spec, the spend cap and rate limit apply to LLM calls. The cost-controls middleware is applied only to `/llm/turn`; retrieval and auth are not rate-limited/capped. Spend is the cumulative cost of dispatched tool calls in a session (from the `HttpLlmResponseBody`'s tool calls, costed via the `HttpLlmRequestBody`'s tool cost metadata). The usage-tracking store is in-memory initially (keyed by session id), swappable for Redis.

### Webhook recompiles everything

The initial webhook handler recompiles the entire content source on each webhook (no incremental file-mapping), per the spec allowing the file-mapping to be an implementation detail. The `ContentSource` is a filesystem source rooted at a configured directory (the git working copy the backend is the only component to access). Webhook payload format is not validated strictly in the initial implementation.

## Gaps and open questions

- **Retrieval HTTP wire format ratification.** The endpoint paths, `since`/invalidation JSON, and ToC shape are this app's invention, to be ratified by a refinement of `content-first-retrieval.spec.md`. Flagged for the spec workflow.
- **Pagination scalability.** The backend provider methods return complete result sets (the frontend engine paginates). For large Archives this is an open scalability concern not addressed by the current provider interfaces. Noted; out of scope for the initial backend.
- **Redis store.** The in-memory store is a placeholder; the Redis/Upstash-backed provider implementations are a follow-up. The provider-interface abstraction makes this a swap.
- **Streaming LLM.** `OpenRouterLlmProvider` is non-streaming; the backend proxy is non-streaming. Acceptable per the guide package (the loop is turn-at-a-time).
- **Token refresh.** The initial token implementation has an expiry but the backend doesn't expose a refresh endpoint; the Service Worker re-exchanges. A refresh endpoint may be needed; left for now per the spec's "re-exchanging or refreshing as needed" wording.
- **Content source git sync.** The initial `ContentSource` is a plain filesystem source; the git-clone/sync mechanism (the backend being the only component to access the external git repo) is an implementation concern left to deployment.

## Development content directory and content-specific config

A `content/` directory at the workspace root holds seed source Markdown as a development/test stand-in for the external content repository (live content lives separately, per [authoring-tooling.spec.md#content-sources](../../specs/authoring-tooling.spec.md#content-sources) and [usage-and-deployment.spec.md#content-lifecycle](../../specs/usage-and-deployment.spec.md#content-lifecycle)). The backend dev `.env` sets `CONTENT_SOURCE_PATH=../../content` so `pnpm --filter backend dev` compiles it on startup. `FilesystemContentSource` compiles every `.md` it finds recursively, so the directory's own `README.md` becomes a document (slug `content`) — harmless for dev; noted but not excluded.

The directory also carries `darkling.json`, the **content-specific configuration file** that [usage-and-deployment.spec.md#content-specific-configuration](../../specs/usage-and-deployment.spec.md#content-specific-configuration) places in the root of the content repository, versioned with the content: the relationship-type vocabulary and the content-specific retrieval policy (filterable properties + match semantics). Operational config (LLM key, store, spend caps, secrets) is intentionally **not** in this file — it stays in the deployment environment per [Operational configuration](../../specs/usage-and-deployment.spec.md#operational-configuration-in-the-deployment-environment).

The file format (JSON) and the specific values here are an implementation choice — the specs leave the config-file format open and the values implementation-defined. The values in `darkling.json` restate the defaults the code already uses (`RELATIONSHIP_TYPES`, `DEFAULT_PROPERTY_SCHEMA` in `@darkling/knowledge-base`), so the file is a no-op until extended. The backend does not yet read this file at startup; wiring it (so `compileIntoStore` and the retrieval engine receive content-specific config from the content repo, merged with defaults per [policy-and-configuration.spec.md](../../specs/policy-and-configuration.spec.md)) is a follow-up.
