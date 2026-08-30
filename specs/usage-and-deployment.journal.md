# Journal: Usage and deployment

This journal records the development of [usage-and-deployment.spec.md](./usage-and-deployment.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created in response to a user observation that "one area which we haven't discussed, and which might clarify some things, is how we expect/intend this software to be used." The existing specifications are rich on internal architecture (service bus, constrained agent, content model) but thin on deployment, runtime topology, session model, and how the pieces run together. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Deployment shape: client-side SPA + workers, with a serverless backend.** The frontend is a static build served by the hosting platform's static-asset layer; the backend is a serverless Hono application. The user chose serverless (rather than a long-lived server with the model in memory) and platform static-asset serving (rather than the backend serving static assets). The backend is stateless per-invocation, backed by a persistent store (e.g. Upstash/Redis) for the compiled model.
- **Backend responsibilities: LLM proxy + content compilation/retrieval.** The backend does two jobs: proxies the Guide's LLM calls (holding the API key, abstracting the provider) and owns the content model (compiling source Markdown from an external git repo on webhook into the persistent store, and serving retrieval queries from it). The user specified the content source is a git repository, recompiled on webhook, with the compiled model written to a persistent store (e.g. Upstash) and served from there.
- **LLM provider: abstracted and swappable.** The backend abstracts the LLM behind a provider interface; the specific provider (OpenAI, Anthropic, local) is a configuration choice. Changing providers must not require changing the constrained-agent spec or the frontend. The API key stays on the backend.
- **Guide agent loop: client-side, LLM proxied.** The constrained-agent loop (reasoning, tool dispatch, budget) runs in a Web Worker on the frontend. The LLM call itself is proxied through the backend. The backend does not run the Guide's reasoning.
- **Retrieval: backend serves, frontend caches.** Retrieval executes on the backend, querying the persistent store. The frontend's retrieval worker calls the backend over HTTP and caches/prefetches results in IndexedDB. The user chose backend-served retrieval (rather than shipping the full model to the client and retrieving client-side). The per-index provider interfaces in `@darkling/knowledge-base` are the abstraction boundary: HTTP-client backends on the frontend, Redis/Upstash backends on the backend.
- **Worker topology: broker, Guide, and retrieval in workers; UI on the main thread.** The service bus broker, Guide agent loop, and retrieval/cache worker each run in dedicated Web Workers. The UI runs on the main thread. The user noted that `OffscreenCanvas` may be used for animation in a worker, but general UI logic stays on the main thread.

### Session model — the immersion vs cost-control tension

The user raised a genuine design tension: immersion argues against a conventional logon flow, but cost control and abuse prevention argue for _some_ boundary on who can start a session and for how long. Through dialogue, a secret-for-token exchange model with tiered access was established.

- **Three access tiers, no logon flow.** Anonymous (low caps), token (higher caps), operator (no cap). All tiers are session-per-visit; there are no accounts, no credentials, and no logon UI.
- **Secret-for-token exchange.** Pre-shared secrets (issued out of band) carry predetermined rights; the backend exchanges a presented secret for a signed token (PASETO or JWT) with those rights as claims. Anonymous Visitors (no secret) receive an anonymous token automatically. The tier is a claim inside the token, not a property of who the Visitor is. The user refined the initial "token in URL/cookie" model to this exchange mechanism, noting that having token handling on the client side in a Service Worker would make it largely transparent.
- **Service Worker token handling.** The Service Worker intercepts fetch requests, attaches `Authorization: Bearer <token>` headers where relevant, and handles token lifecycle (exchange, refresh, expiry) transparently. The application code is unaware of tokens; the token is not visible to the page and is not carried in a cookie. This keeps token handling entirely out of the app code and the UI.
- **Session is a single browser visit.** Session state (event queue, budget carryover, interaction input) lives in the browser for the visit. The backend tracks spend/rate-limit counters for the session, keyed by a session identifier derived from the token, and discards them when the session ends.
- **Session state persistence: per-tier configurable.** Whether session state (working memory, budget carryover) persists across visits is configurable per access tier. Persistent tiers store state in IndexedDB across visits for the same browser; ephemeral tiers discard it at visit end. The user chose per-tier configurable persistence (over uniform always-persist or never-persist). This resolves the "implementation policy" gap in the constrained agent spec, which says working memory "does not survive a reset of the Guide's state beyond what implementation policy defines."
- **Cost bounds: per-session spend cap + global rate limit, tier-dependent.** The backend enforces a hard per-session LLM spend cap and a global rate limit, both tier-dependent (from the token's claims). The user selected both mechanisms. The cap and rate-limit values are policy parameters resolved at startup.

### Cap enforcement: diegetic "rest"

The user noted that "in-world the Guide is self-consciously an AI, which gives us some flexibility in breaking the fourth wall." This is used for cap enforcement: when a Visitor hits the per-session spend cap, the Guide presents an in-world "rest" message (the Guide needs to rest or is unavailable) rather than a system error. Because the Guide is self-consciously an AI, acknowledging its own computational limits is diegetically consistent — it doesn't break immersion the way a generic "you've hit your limit" error would. The user chose the in-world rest message over the Guide simply going quiet (FINISHED without a visible message).

## Key decisions and rationale

### Serverless backend with a persistent store

The serverless + persistent-store model keeps the backend stateless per-invocation (scales to zero, no in-memory state to manage) while the compiled model lives durably in the persistent store (fast retrieval, survives cold starts). This aligns with the `@darkling/knowledge-base` package's per-index provider interfaces, which were designed for Redis/Upstash substitution. The backend implements those interfaces against the persistent store; the frontend implements them as HTTP-client backends. The abstraction boundary is the same in both places.

### External git repo, compiled on webhook

The authoring-tooling spec already established that "content sources may live in an external git repository, separate from the application codebase" and that "a webhook notification of a change must trigger recompilation." This spec places that mechanism on the backend: the backend clones/pulls the git repo, compiles on webhook, and writes to the persistent store. The frontend never touches the git repo. This keeps the worldbuilding (the content repo) separate from the software (the application codebase), as the user wanted.

### Provider abstraction keeps the Guide provider-agnostic

The constrained-agent spec defines the Guide's interaction model (tool calls, FINISHED, budget) without referencing a specific LLM provider. The provider abstraction in the backend honours this: the backend exposes a uniform LLM invocation interface, and the provider is a configuration choice. Swapping providers (OpenAI → Anthropic → a local model) changes only the backend's configuration, not the constrained-agent spec, the frontend, or the Guide's behaviour. The API key stays on the backend, so the frontend never holds credentials.

### Tiered access without a logon flow

The three-tier model resolves the immersion/cost tension without a logon UI. Anonymous Visitors can explore (low caps); token-holders get higher caps (issued out of band, via a link); the operator has no cap. No tier requires credentials or per-Visitor identity tracking. The token is in the URL or a cookie, so presenting it is frictionless — the Visitor just visits a link. This is the most immersive option that still bounds cost: the population that can incur high cost is limited to people you've issued tokens to, and even anonymous access is bounded by the low cap.

### Working memory in IndexedDB, cross-visit

Cross-visit working memory gives the Guide continuity: a returning Visitor finds the Guide remembering the prior visit (via working memory), which is more immersive than a fresh Guide each time. Storing it in IndexedDB (browser-only, backend never stores it) keeps the backend stateless and avoids per-Visitor backend state. The per-browser scope (not per-account, since there are no accounts) matches the session model. This resolves the "implementation policy" gap from the constrained agent spec.

### Retrieval worker keeps cache I/O off the main thread

Retrieval and IndexedDB cache management run in a Web Worker so that cache reads/writes and HTTP calls to the backend don't block the UI. The in-memory `@darkling/knowledge-base` store/indexes are used for testing and as a bundled fallback; in production, the retrieval worker uses HTTP-client backends that call the backend, with IndexedDB as the cache. The backend is the source of truth; the cache is a latency optimisation, not an offline store.

## Affected specifications reviewed

- [Service bus](./service-bus.spec.md) — the bus runs on the frontend across Web Workers; the backend is not on the bus. Consistent with the service-bus spec's worker topology. No contradiction.
- [Constrained agent](./constrained-agent.spec.md) — the agentic model (event queue, flush policy, interaction triggering, budget) and the Guide's agent loop run on the frontend; events are produced by the UI and consumed by the Guide, both client-side. LLM calls are proxied through the backend. Working memory persistence (cross-visit, IndexedDB) resolves the "implementation policy" gap noted in the constrained agent spec and journal. No contradiction. (The former event system spec, separately referenced here prior to consolidation, has been merged into the constrained agent spec.)
- [Content model](./content-model.spec.md) — the compiled model is produced by the backend and stored in the persistent store. Consistent; the content model spec governs the model's structure, not where it lives. No contradiction.
- [Content-first retrieval](./content-first-retrieval.spec.md) — retrieval executes on the backend (querying the persistent store); the frontend caches in IndexedDB. The per-index provider interfaces are the abstraction boundary. Consistent; the retrieval spec defines the interface, not where it executes. No contradiction.
- [Authoring tooling](./authoring-tooling.spec.md) — the backend compiles source Markdown from an external git repository on webhook. Consistent with the authoring-tooling spec's content-sources and recompilation-trigger sections. No contradiction.
- [Annotations](./annotations.spec.md) — annotations are part of the compiled model and retrieved as document metadata. Consistent; they are not session state. No contradiction.
- [Agent safety](./agent-safety.spec.md) — the safety consultant is an LLM call proxied through the backend, bounded by the same spend caps. Consistent. No contradiction.
- [Policy and configuration](./policy-and-configuration.spec.md) — policy values (spend caps, rate limits, LLM provider) are resolved at startup. Consistent with the static-resolution requirement. The spend caps and rate limits are new policy parameters owned by this spec; they should be added to a policy parameter table here or cross-referenced. No contradiction.

## Gaps and ambiguities

- **Worker failure recovery.** The spec does not address what happens if a Web Worker (broker, Guide, retrieval) crashes. Recovery and restart semantics are an implementation concern.

## Review-driven revisions

After the initial draft, the user reviewed the spec and raised five architectural points. Each was discussed and the spec was revised accordingly.

### Transferables and OffscreenCanvas

The user noted that the service bus's Transferable objects support was specified with `OffscreenCanvas` in mind, for animating the Guide's avatar. The initial draft mentioned `OffscreenCanvas` only in passing under the main thread section. The spec now notes that Transferable object support is intended to support frame and canvas transfer (e.g. `OffscreenCanvas` frames) for UI rendering generally between workers and the main thread. The user chose "general UI frame transfer" over singling out the avatar use case, keeping the note broad and non-prescriptive; the specific avatar rendering pipeline belongs in a future avatar/UI spec.

### Configuration colocated with content

The user asked whether configuration should be colocated with content — a configuration file in the root of the content repository, with only a couple of environment variables on the deployment to link them together. The decision was a **split**: content-specific configuration (relationship-type vocabulary if configurable, document metadata policies, content-specific retrieval policy) lives in the content repository, versioned with the content; operational configuration (content repo URL, LLM API key, provider selection, persistent store connection, pre-shared secrets, spend caps, rate limits, persistence policies) lives in the deployment environment. Each kind of config lives where it's most relevant. The backend reads both at startup. This keeps worldbuilding config with worldbuilding and the deployment minimal, while keeping operational secrets out of the content repo. A new [Configuration](./usage-and-deployment.spec.md#configuration) section was added.

### Client pre-caches a table of contents

The user asked whether the client should pre-cache some sort of ToC. The decision: on bootstrap, the frontend fetches a lightweight table of contents (document IDs, slugs, titles — no block content) from the backend and caches it in IndexedDB. The ToC is the document-level index: it lets the UI render navigation, the Guide to know what documents exist without a full retrieval, and prefetch to be directed. It's small and high-value, updated on content-version change. A new ToC bullet was added to [Client-side retrieval and caching](./usage-and-deployment.spec.md#client-side-retrieval-and-caching), and the bootstrap sequence now includes fetching the ToC.

### Secret-for-token exchange with Service Worker

The user refined the access model significantly. The initial draft had tokens in URLs/cookies with tier determined by token presence. The user proposed:

1. A mechanism to exchange a pre-shared secret for a token with predetermined rights.
2. Token handling on the client side in a Service Worker, so it would be largely transparent — the Service Worker attaches `Authorization: Bearer <...>` headers and handles token lifecycle.

The spec now defines a **secret-for-token exchange**: pre-shared secrets (issued out of band) carry predetermined rights; the backend exchanges a presented secret for a signed token (PASETO or JWT) with those rights as claims. Anonymous Visitors (no secret) receive an anonymous token automatically. The Service Worker manages the token lifecycle transparently — exchange, refresh, expiry, attaching the bearer header to backend requests — keeping the token out of the page and the application code. A new [Access and authentication](./usage-and-deployment.spec.md#access-and-authentication) section replaces the old "Access tiers" section, and a new [Service Worker](./usage-and-deployment.spec.md#service-worker) subsection was added to the runtime topology.

### Backend stores — content/config cache, secret store, usage tracking

The user identified three store-related requirements that the initial draft left implicit:

1. **Configuration cache.** The backend can cache resolved configuration (except secrets) in the same persistent store it uses for compiled content. This avoids re-reading the content repository and re-resolving the environment on every serverless invocation.
2. **Secret store.** Pre-shared secrets need a store. The user suggested this may but need not be the same store as the content (e.g. Upstash/Redis). Secrets must not be cached in or readable from the persistent store.
3. **Usage tracking.** The backend needs to track usage against per-session spend caps and global rate limits. Since the backend is stateless per-invocation, usage counters must persist in a store across invocations.

A new [Backend stores](./usage-and-deployment.spec.md#backend-stores) section was added, defining three logical stores — persistent (content + non-secret config cache), secret, and usage tracking — which may share a physical store. The Configuration section now references config caching; the Pre-shared secrets section references the secret store; and the Cost and abuse controls section references the usage tracking store. The operational configuration was clarified: pre-shared secrets are held in the secret store, not in the deployment environment.

### Session state persistence configurable by access tier

The user was open on whether session state should persist, and suggested it should be configurable by access tier. The spec now defines session state persistence (working memory, budget carryover) as **per-tier configurable**: persistent tiers store state in IndexedDB across visits; ephemeral tiers discard it at visit end. The persistence policy is a property of the tier, determined by the token's claims and the configuration. This replaces the initial draft's uniform "always persist in IndexedDB" model. The [Session state persistence](./usage-and-deployment.spec.md#session-state-persistence) section and its Gherkin scenarios were revised accordingly.

### Cache invalidation via last-access invalidation list

The user proposed a cache invalidation mechanism: when making a retrieval call, the client includes a timestamp of last access; the backend responds with the requested data plus a list of what has changed. The user clarified an important distinction: it's a cache, not a local copy — the backend should send only a list of IDs whose cache entries are no longer valid, not a full delta of changed content. It's up to the client to decide whether and when to reload the invalidated content (e.g. on next access, or eagerly).

The spec now defines **cache invalidation via a last-access invalidation list**: when making a retrieval call, the frontend includes a last-access timestamp; the backend responds with the requested data and a list of IDs of documents and content blocks whose cached entries are no longer valid (added, modified, or removed since that timestamp). The frontend invalidates those entries; it does not receive the changed content. The ToC is invalidated via the same list.

### Retrieval service on the frontend bus, backed by HTTP to the backend

A review of the spec against the service-bus spec identified a tension: the service-bus spec says "the retrieval interface is accessed through services on the bus," but the initial usage-and-deployment draft said "the frontend's retrieval worker calls the backend over HTTP." The resolution, chosen by the user: the retrieval service runs on the **frontend's service bus** (as the `@darkling/knowledge-base` package provides), but its store and index providers are HTTP-client backends that call the backend over HTTP. The Guide calls retrieval via the bus; the bus service forwards to the backend. The service-bus spec is correct as-is. The usage-and-deployment spec's retrieval wording was revised to reflect this: the retrieval service runs on the frontend bus, with HTTP-client providers behind it.

### Cross-specification linkage review

After the usage-and-deployment spec was substantially complete, a review against the other specifications identified editorial linkage changes (non-normative cross-references, no behavioural changes):

- [Policy and configuration](./policy-and-configuration.spec.md) — the "Relationship to domain specifications" section now lists usage-and-deployment among the specs that define policy parameters (spend caps, rate limits, persistence policies per tier).
- [Constrained agent](./constrained-agent.spec.md) — the working memory "Persistence and scope" section now links to usage-and-deployment for the implementation policy on working memory persistence (per-tier, IndexedDB), resolving the "beyond what implementation policy defines" gap.
- [Content-first retrieval](./content-first-retrieval.spec.md) — the "Storage and indexing" section now notes the deployment model (retrieval service on the frontend bus, backed by HTTP to the backend's persistent store, frontend cache) and that the spec is deployment-agnostic. The retrieval journal notes the cache invalidation interface (`since` parameter + invalidation-list result shape) as a future change to that spec.
- [Authoring tooling](./authoring-tooling.spec.md) — the "Content sources" section now links to usage-and-deployment for the backend's role (accessing the git repo, compiling on webhook, writing to the persistent store) and the content-specific configuration file in the content repo.
- [Service bus](./service-bus.spec.md) — no change needed. The service-bus spec's statement that "retrieval is accessed through services on the bus" is correct: the retrieval service runs on the frontend bus, with HTTP-client store/index providers behind it.

The user was unsure whether this lives in the usage-and-deployment spec or the content-first-retrieval spec. The decision: the **requirement** (the mechanism exists, the caching behaviour it enables) lives here; the **interface** (the `since` parameter on the retrieval API and the invalidation-list result shape) belongs in [Content-first retrieval](./content-first-retrieval.spec.md), to be established via the specification workflow.

## Gaps and ambiguities (revised)

- **Session identifier.** The spec says the backend tracks spend/rate-limit counters keyed by a session identifier derived from the token. How the session identifier is derived from the token (e.g. a session claim in the token, or a hash of the token + a nonce) is an implementation concern.
- **Cache invalidation interface in the retrieval spec.** This spec requires that a cache invalidation mechanism exists (the client sends a last-access timestamp; the backend returns a list of IDs whose cache entries are no longer valid, alongside the requested data). The specific retrieval API interface — the `since` parameter and the invalidation-list result shape — belongs in [Content-first retrieval](./content-first-retrieval.spec.md), to be established via the specification workflow.
- **Secret issuance and revocation.** The spec says pre-shared secrets are "issued out of band" but does not define the issuance, rotation, or revocation mechanism. This is an operator concern; may warrant operator documentation.
- **Policy parameter table.** The spend caps, rate limits, and persistence policies are policy parameters governed by [Policy and configuration](./policy-and-configuration.spec.md). A formal policy parameter table in this spec (or a cross-reference) is a follow-up.
- **Offline capability.** The cache is not offline-first. If offline capability becomes a goal, a spec change would be required.
- **Multiple concurrent Visitors on the same browser.** The per-browser state model assumes one Visitor per browser. Multiple tabs share the IndexedDB store and Service Worker; whether they share or conflict on session state is not defined. An implementation concern.
- **Worker failure recovery.** The spec does not address what happens if a Web Worker (broker, Guide, retrieval) or the Service Worker crashes. Recovery and restart semantics are an implementation concern.
- **Token format choice (PASETO vs JWT).** The spec names both as options. The specific choice is an implementation concern; it may warrant clarification.

## Session start event

Added a bootstrap-sequence step and a Gherkin assertion: after the UI is
mounted, the UI emits `session_start` (trigger probability 1.0), which flushes
the queue and triggers the Guide's first interaction. This closes the gap that
the bootstrap sequence previously said "the Guide begins consuming events and
responding" without producing any event to trigger the first interaction.

The event type is owned by the UI spec (ui.spec.md#session-start); the framing
(Visitor-initiated, not a system event) and the empty payload / once-per-load /
emitted-before-Visitor-input decisions are recorded in ui.journal.md.
