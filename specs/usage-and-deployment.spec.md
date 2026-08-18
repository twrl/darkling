# Usage and deployment

## Purpose and scope

This specification defines how the Darkling system is used and deployed: the runtime topology, the responsibilities of the frontend and backend, the session model, the cost and access controls, and the lifecycle of content and Guide state across visits.

It governs:

- the deployment shape — the frontend, the backend, and their respective responsibilities;
- the runtime topology — which subsystems run where (frontend workers, main thread, backend);
- the LLM provider abstraction — how the Guide's LLM is reached and how the provider is selected;
- the content lifecycle — where source material lives, how it is compiled, and how the compiled model is served;
- the retrieval path — where retrieval executes and how the frontend caches;
- the session model — access tiers, session lifecycle, and working memory persistence;
- the cost and abuse controls — spend caps, rate limits, and what happens when they are reached.

It is explicitly out of scope for this specification to define:

- the internal behaviour of the subsystems — the service bus, event system, constrained agent, content model, retrieval, annotations, and policy and configuration — which are defined by their respective specifications;
- the specific LLM provider or its API — which is a configuration choice, as defined in [LLM provider abstraction](#llm-provider-abstraction);
- the specific persistent store technology (e.g. Upstash, Redis) — which is an implementation concern;
- the authoring format and compilation pipeline internals — which are defined by [Authoring tooling](./authoring-tooling.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Design context

Darkling is an immersive, single-Visitor experience: a person (the Visitor) explores the Archive in the company of the Guide. The system is designed to minimise friction to entry — there is no conventional logon flow — while bounding LLM cost and abuse through tiered access and spend controls. The Guide is self-consciously an AI within the fiction, which gives the system diegetic flexibility to acknowledge its own computational nature (e.g. a "rest" framing when a spend cap is reached) without breaking immersion.

The architecture is split across a static frontend (served by the hosting platform) and a serverless backend (Hono) that proxies the LLM and owns content compilation and retrieval. The frontend runs the UI, the Guide's constrained-agent loop, and a retrieval/cache worker across Web Workers; the backend is stateless per-invocation and backed by a persistent store for the compiled model.

## Deployment shape

Darkling is deployed as two components:

- **Frontend** — a static build (produced by Vite) served by the hosting platform's static-asset layer (e.g. Vercel static, Cloudflare Pages). The frontend is a single-page application that runs the UI, the Guide, and client-side services across Web Workers, as defined in [Runtime topology](#runtime-topology).
- **Backend** — a serverless application (Hono) exposing an HTTP API. The backend is stateless per-invocation: it holds no in-memory session or compiled-model state between requests. It is backed by a persistent store (e.g. Upstash/Redis) for the compiled model and by configuration for the LLM API key. The backend has two responsibilities, defined in [Backend responsibilities](#backend-responsibilities).

The frontend static build and the backend API may be served from the same origin or from a platform-managed routing layer; the specific arrangement is a deployment concern. The frontend calls the backend over HTTP for LLM proxying and retrieval.

```gherkin
Feature: Deployment shape
  Rule: A static frontend and a serverless backend with a persistent store

  Scenario: Frontend is a static build
    Given the frontend has been built by Vite
    When it is deployed
    Then it must be served as static assets by the hosting platform

  Scenario: Backend is serverless and stateless
    Given the backend is a Hono serverless application
    When a request arrives
    Then the backend must not rely on in-memory state from a previous request
    And the backend must read the compiled model from the persistent store
```

## Backend responsibilities

The backend has two responsibilities: proxying the LLM and owning the content model.

### LLM proxy

The backend proxies LLM calls from the frontend to the LLM provider. The backend holds the LLM API key; the frontend never does.

- The frontend's Guide agent loop calls the backend to invoke the LLM, as defined in [Guide agent loop](#guide-agent-loop).
- The backend forwards the request to the configured LLM provider and returns the response.
- The backend applies the cost and abuse controls defined in [Cost and abuse controls](#cost-and-abuse-controls) before forwarding.

The LLM provider is abstracted behind a provider interface, as defined in [LLM provider abstraction](#llm-provider-abstraction).

### Content compilation and retrieval

The backend owns the compiled content model: it compiles source material into the persistent store and serves retrieval queries from it.

- **Compilation.** The backend reads source Markdown from an external git repository, compiles it into the compiled content model (as defined by [Authoring tooling](./authoring-tooling.spec.md) and [Content model](./content-model.spec.md)), and writes the result to the persistent store. Compilation is triggered on webhook when the content source changes, as defined in [Content lifecycle](#content-lifecycle).
- **Retrieval.** The backend serves retrieval queries over HTTP, reading from the persistent store. The retrieval interface conforms to [Content-first retrieval](./content-first-retrieval.spec.md); the backend's persistent store provides the block store, property index, text index, relationship index, and containment index defined there. The per-index provider interfaces established by `@darkling/knowledge-base` are the abstraction boundary: the backend implements them against the persistent store; the frontend implements them as HTTP-client backends that call the backend.

```gherkin
Feature: Backend responsibilities
  Rule: The backend proxies the LLM and serves retrieval from a persistent store

  Scenario: LLM call is proxied
    Given the Guide agent loop on the frontend needs an LLM response
    When it calls the backend
    Then the backend must forward the request to the configured LLM provider
    And the backend must hold the API key, not the frontend

  Scenario: Retrieval serves from the persistent store
    Given the compiled model is stored in the persistent store
    When the frontend requests a retrieval query
    Then the backend must query the persistent store
    And the backend must return the result over HTTP

  Scenario: Compilation writes to the persistent store
    Given the content source has changed
    When the backend receives a webhook
    Then the backend must recompile the source
    And the backend must write the compiled model to the persistent store
```

## LLM provider abstraction

The backend abstracts the LLM behind a provider interface. The specific provider (e.g. OpenAI, Anthropic, a local model) is a configuration choice, not baked into the system.

- The backend must expose a uniform interface for LLM invocation regardless of the underlying provider.
- The provider is selected by configuration, as defined by [Policy and configuration](./policy-and-configuration.spec.md). Changing the provider must not require changing the constrained-agent specification or the frontend.
- The API key for the selected provider is held by the backend; it must not be sent to the frontend.
- The provider interface must accommodate the constrained agent's interaction model: the backend receives the prompt/status input (event queue, budget, working memory, undispatched tool calls) and returns the model's response (tool calls and FINISHED signal), as defined by [Constrained agent](./constrained-agent.spec.md).

```gherkin
Feature: LLM provider abstraction
  Rule: The LLM is behind a provider interface; the provider is a configuration choice

  Scenario: Provider is swappable
    Given the backend is configured with provider A
    When the configuration is changed to provider B
    Then the backend must invoke provider B
    And the constrained agent specification and frontend must not change

  Scenario: API key stays on the backend
    Given the backend holds the API key for the configured provider
    When the frontend calls the backend to invoke the LLM
    Then the API key must not be sent to the frontend
```

## Runtime topology

The frontend runs across the main thread and Web Workers. Each subsystem runs where its constraints require.

### Main thread

The UI runs on the main thread: Lit components, rendering, and event production. UI logic must not run in a worker. Animation may use `OffscreenCanvas` in a worker where appropriate, but general UI logic remains on the main thread.

The service bus's support for Transferable objects, as defined by [Service bus](./service-bus.spec.md#transferable-objects), is intended to support the transfer of frame and canvas data (e.g. `OffscreenCanvas` frames for UI rendering) between workers and the main thread without copying. This is a general UI rendering concern; the specific rendering pipeline is defined by the UI specification.

### Service Worker

A Service Worker runs in the browser, intercepting fetch requests from the frontend. Its responsibility is token handling: it attaches `Authorization: Bearer <token>` headers to requests destined for the backend (LLM proxy and retrieval) and manages the token lifecycle (exchange, refresh, expiry) transparently, as defined in [Access and authentication](#access-and-authentication).

The Service Worker keeps token handling entirely out of the application code and the UI. The frontend's application code makes ordinary `fetch` calls; the Service Worker intercepts, attaches the bearer header, and manages the token. The token is not visible to the page and is not carried in a cookie.

### Web Workers

Three subsystems run in dedicated Web Workers, as established by their respective specifications:

- **Service bus broker** — runs in a dedicated Web Worker, routing calls between the Guide, retrieval, and other services, as defined by [Service bus](./service-bus.spec.md).
- **Guide agent loop** — the constrained-agent loop (reasoning, tool dispatch, budget enforcement, event consumption) runs in a dedicated Web Worker, isolated from the main thread, as defined by [Constrained agent](./constrained-agent.spec.md). The Guide's LLM calls are proxied through the backend, as defined in [LLM proxy](#llm-proxy).
- **Retrieval and cache** — the retrieval service runs on the frontend's service bus in a Web Worker, as defined by [Service bus](./service-bus.spec.md). Its store and index providers are HTTP-client backends that call the backend over HTTP, and it manages the IndexedDB cache and prefetch, as defined in [Client-side retrieval and caching](#client-side-retrieval-and-caching). Keeping cache I/O off the main thread prevents retrieval and IndexedDB operations from blocking the UI.

```gherkin
Feature: Runtime topology
  Rule: UI on the main thread; Service Worker for tokens; broker, Guide, and retrieval in workers

  Scenario: UI on the main thread
    Given the frontend is running
    Then the UI (rendering, event production) must run on the main thread

  Scenario: Service Worker handles tokens transparently
    Given the frontend makes a fetch request to the backend
    When the request is intercepted by the Service Worker
    Then the Service Worker must attach the Authorization header
    And the application code must not handle the token directly

  Scenario: Guide agent loop in a worker
    Given the Guide is active
    Then the constrained-agent loop must run in a dedicated Web Worker
    And it must not block the main thread

  Scenario: Retrieval and cache in a worker
    Given the retrieval service is active
    Then retrieval queries and IndexedDB cache management must run in a Web Worker
    And cache I/O must not block the main thread
```

## Content lifecycle

Archive content is authored as semantically enriched Markdown in an external git repository, separate from the application codebase, as defined by [Authoring tooling](./authoring-tooling.spec.md#content-sources).

- **Source location.** The source Markdown lives in an external git repository. The backend is the only component that accesses the git repository; the frontend never does.
- **Compilation.** The backend compiles the source into the compiled content model (documents and content blocks conforming to [Content model](./content-model.spec.md)) and writes the result to the persistent store. Compilation conforms to the [compilation contract](./content-model.spec.md#compilation-contract) (deterministic identity, slugs, containment, relationships; rejection of unrecognised types and unresolved targets with reporting).
- **Recompilation trigger.** Recompilation is triggered by a webhook notifying that the content source has changed, as defined by [Authoring tooling](./authoring-tooling.spec.md#recompilation-trigger). The backend receives the webhook, recompiles the affected source, and updates the persistent store. The specific webhook payload format and the mapping from webhook to affected files is an implementation concern.
- **Serving.** The backend serves retrieval queries from the persistent store, as defined in [Backend responsibilities](#backend-responsibilities). The compiled model is not shipped as a static asset; it lives in the persistent store and is queried at runtime.

```gherkin
Feature: Content lifecycle
  Rule: Source in an external git repo; compiled into a persistent store by the backend on webhook

  Scenario: Source in external git repo
    Given the content source is a git repository
    Then the backend must be the only component that accesses it
    And the frontend must not access the git repository

  Scenario: Webhook triggers recompilation
    Given the content source has changed
    When the backend receives a webhook
    Then the backend must recompile the affected source
    And the backend must update the persistent store with the compiled model

  Scenario: Compiled model served from the persistent store
    Given the compiled model is in the persistent store
    When the frontend requests retrieval
    Then the backend must query the persistent store
    And the compiled model must not be shipped as a static asset
```

## Client-side retrieval and caching

The retrieval service runs on the frontend's service bus, as defined by [Service bus](./service-bus.spec.md) and provided by the `@darkling/knowledge-base` package's service declaration. The Guide retrieves content through the bus, as defined by [Content-first retrieval](./content-first-retrieval.spec.md). The retrieval service's store and index providers are HTTP-client backends that call the backend over HTTP, which queries the persistent store. The retrieval service also maintains a client-side cache with prefetch in IndexedDB, keeping cache I/O off the main thread.

- **Cache.** The frontend caches retrieved documents and content blocks in IndexedDB. The cache is a client-side optimisation; the backend's persistent store is the source of truth.
- **Prefetch.** The frontend may prefetch likely-needed content — for example, a document's block tree when the document is opened, or the targets of a block's relationships when the block is retrieved. Prefetch reduces latency for subsequent retrieval calls.
- **Cache invalidation.** The cache is a cache, not a local copy: the backend's persistent store is the source of truth, and cached entries may become stale when the compiled model is recompiled. To facilitate this, when making a retrieval call the frontend may include a last-access timestamp (the time of its last successful synchronisation). The backend responds with the requested data and, in addition, a list of IDs of documents and content blocks whose cached entries are no longer valid — those that have been added, modified, or removed since that timestamp. The frontend invalidates the listed cache entries and updates its last-access timestamp. The backend does not send the changed content itself; it sends only the list of invalid IDs. It is up to the client to decide whether and when to reload the invalidated content (e.g. on next access, or eagerly). This piggybacks invalidation on every retrieval call, so the client stays current without a separate invalidation polling endpoint.
- **Table of contents.** On bootstrap, the frontend fetches a lightweight table of contents from the backend and caches it in IndexedDB. The ToC is the document-level index: document IDs, slugs, and titles (no block content). It lets the UI render navigation, the Guide to know what documents exist without a full retrieval, and prefetch to be directed. The ToC is small and high-value; it is invalidated via the same invalidation list as the rest of the cache.
- **Offline.** The cache is not an offline-first store. Darkling requires a network connection to the backend for LLM calls and for cache misses. The cache reduces latency, not network dependency.

The in-memory store and index implementations provided by `@darkling/knowledge-base` are used for testing and as a bundled fallback; in production, the frontend's retrieval worker uses HTTP-client backends that call the backend, backed by the IndexedDB cache.

```gherkin
Feature: Client-side retrieval and caching
  Rule: Retrieval from the backend; results cached and prefetched in IndexedDB

  Scenario: Cache invalidation piggybacks on retrieval
    Given the frontend has a last-access timestamp T
    When the frontend makes a retrieval call including T
    Then the backend must return the requested data
    And the backend must return a list of IDs whose cache entries are no longer valid
    And the backend must not return the changed content itself
    And the frontend must invalidate the listed cache entries
    And the frontend must decide whether and when to reload the invalidated content

  Scenario: Cache serves repeated retrieval
    Given a block has been retrieved and cached
    When the same block is requested again
    Then the frontend may serve it from the cache
    And the backend is the source of truth

  Scenario: Prefetch reduces latency
    Given a document has been opened
    When its root block is retrieved
    Then the frontend may prefetch the document's block tree
```

The specific interface for the cache invalidation list — the `since` parameter on the retrieval API and the invalidation-list result shape (IDs of documents and content blocks that are no longer valid) — is defined by [Content-first retrieval](./content-first-retrieval.spec.md), to be established via the specification workflow. This specification requires that the mechanism exists and describes the caching behaviour it enables.

## Access and authentication

Darkling has no accounts and no logon flow. Access is governed by a secret-for-token exchange: pre-shared secrets (issued out of band) carry predetermined rights; the backend exchanges a presented secret for a signed token (PASETO or JWT) with those rights as claims. The token's claims determine the Visitor's access tier and the cost and abuse controls applied, as defined in [Cost and abuse controls](#cost-and-abuse-controls).

### Pre-shared secrets

A **pre-shared secret** is an out-of-band-issued credential that carries predetermined rights (the access tier and any associated caps or limits). Secrets are issued by the operator and shared via a link or other out-of-band channel.

- Secrets are held in the secret store, as defined in [Secret store](#secret-store).
- A secret is presented to the backend, which validates it against the secret store and issues a signed token with the secret's rights as claims.
- Secrets are single-use for exchange: presenting a secret yields a token; the secret is not subsequently needed.
- The specific secret format and issuance mechanism is an implementation concern; this specification requires that the exchange mechanism exists.

### Token issuance and tiers

The backend issues a signed token (PASETO or JWT) to every Visitor. The token carries an access-tier claim. There are three tiers:

- **Anonymous** — the default. A Visitor who arrives with no secret is issued an anonymous token automatically. Anonymous Visitors are subject to lower per-session spend caps and lower global rate limits.
- **Token** — a Visitor who presents a valid pre-shared secret with token rights is issued a token-tier token. Token-holders are subject to higher per-session spend caps and higher global rate limits.
- **Operator** — a Visitor who presents a pre-shared secret with operator rights is issued an operator-tier token. The operator tier has no spend cap and no rate limit.

No tier requires a logon flow, credentials, or per-Visitor identity tracking. The tier is a claim inside the token, not a property of who the Visitor is.

### Service Worker token handling

The Service Worker manages the token lifecycle transparently, as defined in [Service Worker](#service-worker). The application code is unaware of tokens:

- The Service Worker exchanges a presented secret for a token, or requests an anonymous token if no secret is presented.
- The Service Worker stores the token and attaches `Authorization: Bearer <token>` to requests destined for the backend.
- The Service Worker handles token refresh and expiry, re-exchanging or refreshing as needed.
- The token is not visible to the page and is not carried in a cookie.

The backend validates the token on each request and applies the tier's caps and limits. The frontend's application code is unaware of the tier except to display in-world messaging when a cap is reached, as defined in [Cap enforcement](#cap-enforcement).

```gherkin
Feature: Access and authentication
  Rule: Pre-shared secrets exchanged for signed tokens; anonymous tokens issued automatically; no logon UI

  Scenario: Anonymous Visitor gets a token automatically
    Given a Visitor reaches the frontend with no secret
    When the Service Worker requests a token
    Then the backend must issue an anonymous-tier token
    And no logon UI must be shown

  Scenario: Secret exchanged for a token
    Given a Visitor presents a valid pre-shared secret with token rights
    When the Service Worker exchanges the secret
    Then the backend must issue a token-tier token carrying the rights as claims
    And no logon UI must be shown

  Scenario: Service Worker attaches the token transparently
    Given the Service Worker holds a valid token
    When the frontend makes a fetch request to the backend
    Then the Service Worker must attach the Authorization header
    And the application code must not handle the token

  Scenario: Operator secret yields an operator token
    Given a Visitor presents a pre-shared secret with operator rights
    When the Service Worker exchanges the secret
    Then the backend must issue an operator-tier token
    And the backend must apply no spend cap and no rate limit
```

## Session model

A **session** is a single browser visit: from page load to the page being closed or reloaded.

### Session lifecycle

- Session state — the event queue, budget carryover, and the Guide's interaction input — lives in the browser for the visit.
- Whether session state persists across visits is configurable per access tier, as defined in [Session state persistence](#session-state-persistence).
- The backend does not store per-session Guide state. The backend tracks spend and rate-limit counters for the duration of a session, keyed by a session identifier derived from the token; these counters are discarded when the session ends.

### Session state persistence

Whether the Guide's session state — working memory and budget carryover — persists across visits is **configurable per access tier**. The persistence policy is a property of the tier, determined by the token's claims and the configuration, as defined in [Configuration](#configuration).

- A tier whose persistence policy is **persistent** stores working memory and budget carryover in IndexedDB across visits for the same browser. On a return visit, the Guide resumes with its prior state.
- A tier whose persistence policy is **ephemeral** discards session state at the end of each visit. Each visit starts the Guide fresh.
- Clearing site data (or the specific IndexedDB store) resets persisted state regardless of tier.
- Session state is per-browser, not per-account: there are no accounts, so the browser is the scope of persistence.

[Constrained agent](./constrained-agent.spec.md#working-memory) states working memory "does not survive a reset of the Guide's state beyond what implementation policy defines." This specification establishes that implementation policy: working memory persistence is per-tier, with persistent tiers storing it in IndexedDB and ephemeral tiers discarding it at visit end.

```gherkin
Feature: Session state persistence
  Rule: Persistence is configurable per access tier

  Scenario: Persistent tier survives a visit
    Given a Visitor in a persistent tier has working memory W at the end of a visit
    When the Visitor returns in the same browser
    Then the Guide must resume with working memory W

  Scenario: Ephemeral tier resets each visit
    Given a Visitor in an ephemeral tier has working memory W at the end of a visit
    When the Visitor returns in the same browser
    Then the Guide must start fresh, without W

  Scenario: Clearing site data resets persisted state
    Given a Visitor in a persistent tier has working memory W
    When the Visitor clears site data
    Then the Guide must start fresh on the next visit
```

## Cost and abuse controls

LLM cost and abuse are bounded by two mechanisms, applied per the Visitor's access tier:

- **Per-session spend cap.** The backend enforces a hard cap on LLM spend per session. When the cap is reached, the Guide stops responding, as defined in [Cap enforcement](#cap-enforcement). The cap value is tier-dependent: anonymous (low), token (higher), operator (none).
- **Global rate limit.** The backend enforces a global rate limit on LLM calls across all sessions, preventing aggregate cost runaway regardless of Visitor count. The rate limit value is tier-dependent: anonymous (low), token (higher), operator (none).

The cap and rate-limit values are policy parameters, as defined by [Policy and configuration](./policy-and-configuration.spec.md). They must have defined values for each tier, resolved at startup, as defined in [Static resolution](./policy-and-configuration.spec.md#static-resolution). The backend tracks usage against these caps and limits in the usage tracking store, as defined in [Usage tracking store](#usage-tracking-store).

### Cap enforcement

When a Visitor's per-session spend cap is reached, the Guide must stop incurring LLM cost. The enforcement is diegetic: the Guide is self-consciously an AI within the fiction, so the cap is presented in-world rather than as a system error.

- When the cap is reached, the backend must refuse further LLM calls for that session.
- The frontend must present an in-world "rest" message — the Guide indicates it needs to rest or is otherwise unavailable — rather than a system error or a fourth-wall-breaking limit notification.
- The Guide must not dispatch further tool calls or produce free text after the cap is reached; the interaction ends as if the Guide returned FINISHED without dispatching, as defined by [Constrained agent](./constrained-agent.spec.md#finished).
- The cap resets when the session resets (page reload or close).

```gherkin
Feature: Cost and abuse controls
  Rule: Per-session spend cap and global rate limit, tier-dependent; cap hit is diegetic

  Scenario: Per-session spend cap reached
    Given an anonymous Visitor has incurred LLM spend up to the anonymous cap
    When the Guide attempts another interaction
    Then the backend must refuse the LLM call
    And the frontend must present an in-world rest message
    And the Guide must not dispatch further tool calls

  Scenario: Cap is tier-dependent
    Given an anonymous Visitor has a low spend cap
    And a token-holding Visitor has a higher spend cap
    When both incur the same spend
    Then the anonymous Visitor may reach the cap
    And the token-holding Visitor may not

  Scenario: Global rate limit reached
    Given the global rate limit has been reached for the anonymous tier
    When an anonymous Visitor attempts an LLM call
    Then the backend must refuse the call
```

## Backend stores

The backend is stateless per-invocation, so the state it requires between requests is held in stores. The backend uses three logical stores, which may be backed by the same or different physical stores.

### Persistent store (content and configuration cache)

The persistent store (e.g. Upstash/Redis) holds the compiled content model, as defined in [Content lifecycle](#content-lifecycle). It also holds a cache of non-secret configuration: the backend reads content-specific configuration from the content repository and operational configuration from the deployment environment, and caches the resolved configuration in the persistent store so that subsequent invocations do not need to re-read the content repository or re-resolve the environment. The cache is updated on recompilation (for content-specific config) and on deployment change (for operational config).

Secrets are not cached in the persistent store; they are held in the secret store, as defined in [Secret store](#secret-store).

### Secret store

Pre-shared secrets, as defined in [Pre-shared secrets](#pre-shared-secrets), are held in a secret store. The secret store may but need not be the same physical store as the persistent store (e.g. a separate Redis database, a dedicated secrets manager, or a separate keyspace). The backend validates presented secrets against the secret store during the token exchange.

- Secrets must not be cached in or readable from the persistent store.
- The specific secret store technology is an implementation concern; this specification requires that a secret store exists and that the backend can validate presented secrets against it.

### Usage tracking store

The backend tracks LLM usage to enforce the per-session spend caps and global rate limits defined in [Cost and abuse controls](#cost-and-abuse-controls). Usage is tracked in a store that persists across serverless invocations (since the backend is stateless per-invocation).

- **Per-session usage.** The backend records accumulated LLM spend for each session, keyed by a session identifier derived from the token. The backend checks this record before forwarding an LLM call and refuses the call if the session's spend cap is reached.
- **Global rate limiting.** The backend records LLM call counts (or spend) globally or per tier, keyed by a time window. The backend checks this record before forwarding an LLM call and refuses the call if the rate limit is reached.
- Per-session usage records are discarded when the session ends. Global rate-limit records are retained for the duration of their time window and then discarded.
- The usage tracking store may but need not be the same physical store as the persistent store or the secret store. The specific technology is an implementation concern.

```gherkin
Feature: Backend stores
  Rule: Three logical stores — persistent (content + config cache), secret, usage tracking — which may share a physical store

  Scenario: Configuration cached in the persistent store
    Given the backend has resolved configuration from the content repo and environment
    When the backend caches the resolved configuration
    Then the cache must be in the persistent store
    And the cache must not include secrets

  Scenario: Secrets held in the secret store
    Given the operator has issued pre-shared secrets
    Then the secrets must be held in the secret store
    And the secrets must not be readable from the persistent store

  Scenario: Usage tracked across invocations
    Given a serverless invocation incurs LLM spend for a session
    When a subsequent invocation checks the session's spend
    Then the usage tracking store must return the accumulated spend
    And the backend must refuse the call if the spend cap is reached
```

Configuration is split between the content repository and the deployment environment, each holding the kind of configuration most relevant to it. The backend caches resolved configuration (except secrets) in the persistent store, as defined in [Persistent store](#persistent-store-content-and-configuration-cache).

### Content-specific configuration (in the content repository)

A configuration file lives in the root of the content repository, alongside the source Markdown. It holds configuration that is part of the worldbuilding and versioned with the content:

- content-specific policy (e.g. the relationship-type vocabulary, if configurable beyond the default, and document metadata policies);
- any content-specific retrieval policy parameters (e.g. filterable properties, if extended beyond the default schema).

The backend reads this file when it clones or pulls the content repository, at the same time as it reads the source Markdown. Content-specific configuration is thus versioned with the content it governs.

### Operational configuration (in the deployment environment)

The deployment environment holds configuration that is operational rather than worldbuilding:

- **Operational configuration (in the deployment environment)** — the content repository URL; the LLM API key and provider selection; the persistent store connection; the spend caps and rate limits per tier; the session state persistence policy per tier. The pre-shared secrets and their rights are held in the secret store, as defined in [Secret store](#secret-store), not in the deployment environment.

These are provided as environment variables (or the platform's equivalent). The deployment is minimal: a couple of environment variables link it to the content repository and the LLM provider; everything else is either in the content repo's config file or in the deployment environment.

### Resolution

Both kinds of configuration are resolved at startup, as defined by [Policy and configuration](./policy-and-configuration.spec.md#static-resolution). The backend reads the content repository's config file and the deployment environment's variables when it initialises; the frontend receives its configuration (including the content version for cache invalidation) at bootstrap. Policy values must have defined values, as defined by [Policy and configuration](./policy-and-configuration.spec.md#policy-parameters).

```gherkin
Feature: Configuration
  Rule: Content-specific config in the content repo; operational config in the deployment environment

  Scenario: Content config is versioned with content
    Given the content repository contains a config file
    When the backend clones or pulls the repository
    Then the backend must read the config file alongside the source Markdown
    And the config must be versioned with the content

  Scenario: Operational config is in the deployment environment
    Given the deployment environment provides the content repo URL and LLM API key
    When the backend initialises
    Then the backend must read the operational config from the environment
    And the deployment must not require the content repo to hold operational config

  Scenario: Both resolved at startup
    Given content config and operational config are available
    When the system starts
    Then all policy values must be resolved and have defined values
```

On page load, the frontend bootstraps the runtime:

1. The Service Worker activates and obtains a token (exchanging a presented secret or requesting an anonymous token), as defined in [Access and authentication](#access-and-authentication).
2. The service bus is created and started, with the broker in its Web Worker, as defined by [Service bus](./service-bus.spec.md).
3. The retrieval/cache worker is started, connecting to the backend over HTTP, opening the IndexedDB cache, and fetching the table of contents, as defined in [Client-side retrieval and caching](#client-side-retrieval-and-caching).
4. The Guide agent loop worker is started, connecting to the service bus.
5. The UI is mounted on the main thread, producing events as the Visitor interacts.
6. The Guide begins consuming events and responding, as defined by [Constrained agent](./constrained-agent.spec.md) and [Event system](./event-system.spec.md).

Policy and configuration values are resolved at startup, as defined by [Policy and configuration](./policy-and-configuration.spec.md#static-resolution). The backend's configuration (LLM provider, persistent store connection, pre-shared secrets, spend caps, rate limits, persistence policies) is resolved when the serverless function initialises, from the content repository's config file and the deployment environment, as defined in [Configuration](#configuration).

```gherkin
Feature: Bootstrap
  Rule: The frontend bootstraps the Service Worker, bus, retrieval, Guide, and UI on page load

  Scenario: Frontend bootstrap
    Given the frontend page has loaded
    When the bootstrap runs
    Then the Service Worker must activate and obtain a token
    And the service bus must be started with the broker in a worker
    And the retrieval/cache worker must be started and fetch the ToC
    And the Guide agent loop worker must be started
    And the UI must be mounted on the main thread
```

## Relationship to other specifications

- [Service bus](./service-bus.spec.md) — the bus runs on the frontend across Web Workers; the backend is not on the bus. The bus's Transferable object support enables frame and canvas transfer for UI rendering.
- [Event system](./event-system.spec.md) — the event queue and flush policy run on the frontend; events are produced by the UI and consumed by the Guide.
- [Constrained agent](./constrained-agent.spec.md) — the Guide's agent loop runs in a worker on the frontend; LLM calls are proxied through the backend. Session state persistence (per-tier, configurable) is established here, resolving the "implementation policy" gap noted in the constrained agent spec.
- [Content model](./content-model.spec.md) — the compiled model is produced by the backend and stored in the persistent store; the frontend retrieves it over HTTP.
- [Content-first retrieval](./content-first-retrieval.spec.md) — retrieval executes on the backend (querying the persistent store); the frontend caches results in IndexedDB and fetches a table of contents at bootstrap. The per-index provider interfaces are the abstraction boundary.
- [Authoring tooling](./authoring-tooling.spec.md) — the backend compiles source Markdown from an external git repository on webhook, conforming to the compilation contract. Content-specific configuration lives in the content repository.
- [Annotations](./annotations.spec.md) — annotations are part of the compiled model and retrieved as document metadata; they are not session state.
- [Agent safety](./agent-safety.spec.md) — the safety consultant is an LLM call proxied through the backend, like the Guide's own LLM calls; the safety_consult cost is a policy parameter, bounded by the same spend caps.
- [Policy and configuration](./policy-and-configuration.spec.md) — policy values (including spend caps, rate limits, LLM provider, and persistence policies) are resolved at startup. Configuration is split between the content repository (content-specific) and the deployment environment (operational), as defined in [Configuration](#configuration).

## Conformance

An implementation conforms to this specification when:

- the frontend is a static build served by the hosting platform, running the UI on the main thread, a Service Worker for transparent token handling, and the service bus broker, Guide agent loop, and retrieval/cache worker in dedicated Web Workers; the service bus's Transferable object support enables frame and canvas transfer for UI rendering between workers and the main thread;
- the backend is a serverless application that proxies the LLM (holding the API key, abstracted behind a provider interface) and serves retrieval from a persistent store, reading source Markdown from an external git repository and recompiling on webhook; the backend uses three logical stores — a persistent store (compiled content model and non-secret configuration cache), a secret store (pre-shared secrets), and a usage tracking store (per-session spend and global rate-limit counters) — which may share a physical store;
- the LLM provider is abstracted behind a provider interface and selected by configuration, swappable without changing the constrained-agent specification or the frontend;
- the compiled content model is stored in the persistent store and served by the backend over HTTP; the frontend is not shipped the compiled model as a static asset;
- the frontend caches and prefetches retrieval results in IndexedDB, fetches a table of contents at bootstrap, and invalidates stale cache entries via an invalidation list returned alongside retrieval results (the client decides whether and when to reload);
- access is governed by a secret-for-token exchange: pre-shared secrets (issued out of band, carrying predetermined rights) are exchanged for signed tokens (PASETO/JWT) with the rights as claims; anonymous Visitors receive an anonymous token automatically; no logon flow;
- the Service Worker manages the token lifecycle transparently, attaching `Authorization: Bearer` headers to backend requests; the application code is unaware of tokens;
- session state persistence (working memory, budget carryover) is configurable per access tier, with persistent tiers storing state in IndexedDB across visits and ephemeral tiers discarding it at visit end;
- the backend caches resolved non-secret configuration in the persistent store; secrets are held in a separate secret store, which may but need not be the same physical store;
- the backend tracks LLM usage (per-session spend, global rate-limit counters) in a usage tracking store that persists across serverless invocations, refusing LLM calls when caps or limits are reached;
- the backend enforces a per-session spend cap and a global rate limit, tier-dependent (from the token's claims), with the cap hit presented as an in-world rest message;
- configuration is split between the content repository (content-specific config, versioned with content) and the deployment environment (operational config: repo URL, LLM key, provider, store connections, caps, limits, persistence policies); pre-shared secrets are held in the secret store, not in the deployment environment; both are resolved at startup and cached in the persistent store (except secrets);
- policy values (spend caps, rate limits, LLM provider, persistence policies) are resolved at startup, as defined by [Policy and configuration](./policy-and-configuration.spec.md#static-resolution);
- the frontend bootstraps the Service Worker, service bus, retrieval/cache worker (with ToC fetch), Guide agent loop, and UI on page load.
