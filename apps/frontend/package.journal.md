# `frontend` app — journal

## Creation

Created as the frontend application, replacing the boilerplate Lit/Vite app. The frontend is the SPA defined by `usage-and-deployment.spec.md`: it runs the UI on the main thread, the broker/Guide/retrieval workers, and bootstraps the service bus and state manager on page load. The UI is specified by `ui.spec.md`.

The existing frontend was a Lit+Vite boilerplate (`my-element.ts`, logos, counter). Per the user it didn't need preserving. The tsconfig was updated (added `strict`, `noUncheckedIndexedAccess`, `include: ["src", "test"]`) and an eslint config added. The existing tsconfig uses Vite's `bundler` moduleResolution + `allowImportingTsExtensions` (not the repo's NodeNext base), which is correct for a Vite app.

## Decisions

### CSS 3D transforms, not WebGL

The user chose CSS 3D transforms over Three.js for the rendering. Tablets are DOM elements positioned with `transform: translateZ()/rotateY()` in a perspective container; the ground plane is a `rotateX(90deg)` element; the overlay plane sits above the topmost tablet via `translateZ()`. This keeps the frontend lighter (no WebGL dependency, no Three.js bundle) and is sufficient for the tablet-stack spatial model. The glassy aesthetic is achieved with CSS `backdrop-filter`, `opacity`, and border styling. Trade-off: no real 3D lighting/shaders; the glassy effect is approximated with CSS. Acceptable for the initial implementation; the spec allows any rendering approach provided the spatial model is presented and UI logic runs on the main thread.

### Both in parallel: wiring + UI

The user chose to build wiring and UI in parallel rather than sequentially. The worker topology (broker, guide, retrieval workers, service-bus-host, state-manager-host) and the UI (scene, tablets, avatar, events, tools) are built side by side, connecting as each piece lands.

### Vite native workers

The user chose Vite's native Web Worker support (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`). Vite handles bundling worker entry points; no extra config. Matches the existing service-bus `createWorkerTransport` pattern, which takes a `Worker` or `MessagePort`.

### Event system on the main thread

The event queue and per-event probabilistic flush policy run on the main thread (the UI produces events, the event system triggers interactions), per `event-system.spec.md`. The event queue is a main-thread module that the UI feeds; when a flush occurs, it calls the Guide service's `runInteraction` via the bus. The Guide worker consumes the flushed queue.

### Tools registered on the bus from the main thread

The UI-control (`navigate`, `draw_attention`) and avatar-interaction (`speak`, `set_avatar_position`, `set_avatar_visibility`, `animate_avatar`) tools are registered as services on the bus from the main thread, since they act on the UI (which is on the main thread). The Guide dispatches tool calls to them via the bus; the tools propose `interface` slice updates or dispatch transient effects.

## Gaps and open questions

- **Service Worker for token handling.** The spec requires a Service Worker that transparently attaches `Authorization: Bearer <token>` to backend requests. The initial implementation uses a direct fetch with a token obtained from `/auth/exchange`; the Service Worker is a follow-up. The token is stored in `localStorage` for now (the spec says the token should not be visible to the page — the Service Worker isolates it; the initial impl is a simpler placeholder).
- **IndexedDB cache.** The retrieval/cache worker should cache results in IndexedDB with prefetch and invalidation. The initial implementation fetches directly from the backend on each retrieval call (no cache); the cache is a follow-up.
- **3D rendering details.** The glassy aesthetic, tablet transition animations, avatar figure rendering, and speech visual treatment are all implementation concerns left to the initial CSS 3D implementation. The spec leaves these open.
- **Guide avatar figure.** The spec says the avatar is a "rendered figure" but the visual representation (an image, a CSS shape, an SVG, a canvas) is an implementation concern. The initial implementation uses a CSS-styled placeholder figure.
- **Worker bundling.** Vite handles worker entry points natively; the exact Vite config for multi-worker bundling is to be confirmed at runtime.
## Guide avatar: clippyjs-style sprite animation

Implemented the Guide's avatar figure as a clippyjs-style sprite animator on a
`<canvas>` (`src/ui/avatar/sprite-avatar.ts`, `src/ui/avatar/agent-types.ts`),
wired into `<guide-avatar>` (`src/ui/guide-avatar.ts`). Agent config + sprite
sheet live under `public/agents/darkling/` (`agent.json`, `sprite.png`). `clippyjs`
installed as a devDependency to inspect the real `Animator` semantics; the
library types its own agent data as `any`, so the reverse-engineered
`AgentConfig`/`AnimationDef`/`FrameDef`/`BranchDef` types are kept (they are
strict typing the upstream lib lacks).

### Animation semantics (verified against `clippyjs@0.1.0` dist `Animator`)
The earlier prototype (`lit-clippy-avatar.ts`, removed) had WRONG semantics.
Corrected to match clippyjs exactly:

- **No looping.** Next frame is `index + 1`, clamped to `frames.length - 1`.
  Animations park at the last frame; they do not wrap to 0.
- **Branching** uses a 0..100 scale: `roll = rng()*100`; `if (roll <= weight)
  return frameIndex; else roll -= weight`. If no branch weight is reached,
  advancement FALLS THROUGH to `index + 1` (branching is probabilistic, not
  guaranteed — single-branch frames with weight <100 sometimes advance linearly).
- **exitBranch** is per-frame and gated on a separate `exiting` flag (set via
  `SpriteAvatar.exitAnimation()`), NOT on `useExitBranching`. The next frame
  carrying an `exitBranch` jumps to it, driving an exit sequence.
- **useExitBranching** (animation-level): when at the last frame, the frame
  image is NOT advanced (frozen) and the animation waits for `exitAnimation()`
  rather than running to completion. It does not gate `exitBranch`.

Pure frame-resolution (`resolveNextFrameIndex`/`pickBranch`) extracted and
unit-tested (`test/avatar.test.ts`, 10 tests) since the repo has no DOM test
environment (canvas-driven `SpriteAvatar` follows the same non-DOM-tested
convention as the service-bus/state-manager Lit integrations).

### Rendering approach
clippyjs renders via CSS `background-position` on `overlayCount` stacked divs.
`SpriteAvatar` renders via canvas `drawImage` per `frame.images[i]` cell. Each
`images` entry is a separate overlay layer in clippyjs; sequential `drawImage`
composites them equivalently on canvas. `overlayCount` is accepted in the types
but the canvas impl composites all cells into one canvas (visually equivalent for
the bundled sprite; documented in `sprite-avatar.ts`). Speech, position,
visibility, and Visitor drag-and-snap remain in `<guide-avatar>` unchanged.

### Open / follow-up
- Sounds (`config.sounds` + `frame.sound`) are typed but not played (no audio
  playback yet — impl concern, follow-up).
- The avatar-interaction tool context (`AvatarToolContext`) is not yet wired to
  the `<guide-avatar>` element from the bus tool registration (the tools module
  exists; bus registration is part of the pending wiring, built in parallel per
  the journal's "both in parallel" decision). The element exposes
  `showSpeech`/`setPosition`/`setVisibility`/`playAnimation`/`exitAnimation`-
  ready methods matching the tool surface.

## Clippy is the default avatar

The Guide's avatar is now literally Clippy. `loadClippyAgent()` (in
`sprite-avatar.ts`) loads the canonical Microsoft Agent sprite sheet + animation
data from the `clippyjs` package directly (no copied asset): it dynamically
imports `clippyjs/agents/clippy`, reads the agent config object and the base64
PNG `data:` URL `map` export, and decodes the data URL into an `ImageBitmap`.
`<guide-avatar>` loads Clippy by default; `agentUrl`+`spriteUrl` are now optional
overrides (both must be set to load a different agent from URLs).

`clippyjs` moved from devDependencies to dependencies (it's a runtime import
now). Vite code-splits the clippyjs assets into lazy chunks loaded only when the
avatar initialises: `agent` (~54KB), `map` (~1.78MB sprite), `sounds-mp3`
(~26KB). The large `map` chunk is Clippy's full sprite sheet (loaded on demand).

Clippy's data has no `idle` animation (it has `Idle*` variants:
`IdleAtom`, `IdleSideToSide`, `IdleHeadScratch`, `IdleFingerTap`, `IdleSnooze`,
`IdleEyeBrowRaise`; clippyjs picks a random one as its idle). Our
`idleFrameFor` falls back to sprite cell `(0,0)`, which is Clippy's resting
pose — used only as the static initial frame before any animation runs.

Removed the earlier placeholder `public/agents/darkling/` assets (agent.json +
sprite.png); Clippy from the package replaces them. `dataUrlToBlob` was exported
and tested (5 new tests; avatar suite now 15 tests). GAPS: sounds still not
played; auto-idle (playing a random Idle* animation) is a follow-up.

## Spec change: session_start event

The root specs now establish a `session_start` event (ui.spec.md#session-start,
amended via the specification workflow). The frontend package spec's bootstrap
sequence was updated to add a step: after the UI is mounted, it emits
`session_start` (trigger probability 1.0), which flushes the event queue and
triggers the Guide's first interaction. Implementation wiring (adding
`session_start` to `event-types.ts`, emitting it from the bootstrap path, and
gating Visitor-input production until it is emitted) is a follow-up against the
now-established spec; not yet implemented.

## session_start: implementation

Implemented the session_start wiring against the established spec
(ui.spec.md#session-start). `event-types.ts` adds `session_start` to the
EventType union, the payload union (empty), the Zod enum, and a `sessionStart()`
factory with an empty payload. `event-queue.ts` sets its default trigger
probability to 1.0. `darkling-app.ts` emits `session_start` in `firstUpdated`
(after the first render, when the UI is mounted) and gates all Visitor-activity
event handlers (open/close/attention/traverse/address/avatar-reposition) on a
`sessionStarted` flag so they no-op until session_start has been emitted —
guaranteeing session_start is the sole event in the first flush, per the spec's
"emitted before the UI accepts Visitor input" requirement. Added
`test/session-start.test.ts` (5 tests) covering the factory, schema validation,
and the trigger-probability default.

## Guide services wired (core loop)

Wired the Guide's frontend services, end-to-end through the core agent loop, in response to "write up the Guide's services in the frontend." This establishes the runtime path: the main-thread event queue flushes → the Guide service is called over the bus → the Guide worker runs one interaction → the outcome is returned. Two prerequisite changes were made through dialogue with the user, recorded in the affected packages' journals:

- **`@darkling/guide` `BudgetPolicy.premium` is now a `Record<string, number>`** (event type → premium, summed over the flushed queue) instead of a function, and `random` is optional defaulting to `Math.random`. A map-of-event-types summed over the queue satisfies the root spec's "premium is a function of the event types" requirement while being structured-cloneable, so the policy can cross `postMessage` to the Guide worker. See `packages/guide/package.journal.md`.
- **`@darkling/service-bus` worker-protocol extension**: `ServiceRegistration`/`HostLaunchRequest`/`HostWorkerInit` now carry an optional serialisable per-service `options` bag, which the host worker (and the in-process `InProcessHostSpawner`) keys by service ID and merges into `HostContext.options`. `GuideService` and `KnowledgeBaseService` read from `hostContext.options?.<serviceId>` (falling back to the top-level form for in-process tests). See `packages/service-bus/package.journal.md`.

### Architecture decision: build deps in the worker from serialisable config

The user chose "core only, defer proxies" and noted that, out of testing, the Guide always uses `HttpLlmProvider`. `GuideServiceOptions` (`provider`, `registry`, `budgetPolicy`) is not structured-cloneable, so it cannot cross `postMessage`. The Guide worker therefore builds the loop's non-serialisable dependencies from serialisable config itself, rather than receiving them pre-built. This keeps `@darkling/guide`'s `GuideService` provider/registry-agnostic (its package spec requires this); the construction lives in a frontend-specific service implementation:

- `src/workers/guide-service.ts` — `FrontendGuideService` reads serialisable `FrontendGuideOptions` (`llmEndpoint`, optional `budgetPolicy`, `initialWorkingMemory`, `maxTurns`) from `hostContext.options.guide`, constructs an `HttpLlmProvider` from the endpoint, a `ToolRegistry` seeded with the agent-self `update_working_memory` tool, and (via `GuideService`) a `BudgetTracker` from the policy, then delegates `runInteraction` to `GuideService`.
- `src/workers/guide-declaration.ts` — a frontend-specific declaration (replacing the previous re-export of `@darkling/guide`'s declaration) whose `implementationLoader` dynamically imports `./guide-service.ts`. The wire contract (the `runInteraction` Zod schemas) is duplicated to mirror `@darkling/guide`'s declaration so the broker validates identically; the declaration module imports no implementation, per the service-bus spec. Declared with `as const satisfies ServiceDeclaration` to preserve the concrete function shape for typed proxy creation on the main thread.

### Wiring

- `src/main.ts` registers the `guide` service with `options: { llmEndpoint: '/llm/turn' }` (the backend LLM proxy endpoint; the Service Worker attaches the bearer token).
- `src/ui/darkling-app.ts` now `@consumeServiceClient()`s the `ServiceClient`, builds a typed `guide` proxy (`ServiceInterface<FrontendGuideServiceDeclaration>`) in `updated()` once the client is available, and `handleFlush` calls `guideProxy.runInteraction({ events })` over the bus, bracketing it with `beginInteraction`/`endInteraction` so the queue defers rolls during the interaction and re-rolls on completion. A failed interaction (backend unavailable) does not surface to the Visitor; the queue releases and rolls on the next event. The placeholder `setTimeout` flush is gone.

### Scope: core loop only

The tool registry holds only the agent-self `update_working_memory` tool. The other three categories are deferred (this is the "core only, defer proxies" decision):

- **avatar-and-user-interaction** (`speak`, `set_avatar_position`, `set_avatar_visibility`, `animate_avatar`) — handlers live on the main thread (`src/tools/avatar-tools.ts`) but are not yet registered as bus services or proxied into the Guide worker's registry. Follow-up.
- **ui-control** (`navigate`, `draw_attention`) — same; `src/tools/ui-control-tools.ts` exists but is not bus-registered. Follow-up.
- **knowledge-base-access** — no retrieval tools registered in the Guide registry yet; the `darkling-app` still fetches retrieval directly over HTTP. Follow-up.
- **`safety_consult`** — deferred. [Agent safety](../../specs/agent-safety.spec.md#the-safety-consultant) defines the safety consultant as a separate LLM agent invoked as a bus service; no consultant service or backend endpoint exists yet, so the tool is not registered and the Guide falls back on prompt-level safety guidance, as the guide journal anticipates. Follow-up.

### Tests

`test/guide-service.test.ts` (10 tests) covers `readOptions` (worker-protocol bag, in-process fallback, missing-endpoint errors) and `buildGuideServiceOptions` (provider construction, `update_working_memory` registration, `safety_consult` not registered, default vs provided budget policy, working memory and `maxTurns`). The service-bus options threading is covered by a new test in `packages/service-bus/test/service-bus.test.ts`.

### Gaps

- The Guide worker is not yet exercised end-to-end in a worker (the repo has no jsdom/worker test harness); the in-process path is tested. The worker host's options-keying is mirrored by the in-process spawner so the same code path is covered.
- `darkling-app` still loads documents and ToC via direct `fetch` to the backend, bypassing the knowledge-base bus service; that wiring is a follow-up alongside the knowledge-base-access tool proxies.

## Bootstrap fix: hosts must be ancestors of <darkling-app>

The dev server showed the broker starting but no guide activation and no `session_start` flush, plus a Lit "update scheduled after update completed" warning. Root cause: the `<service-bus-host>` and `<state-manager-host>` were rendered _inside_ `<darkling-app>`'s `render()`, but `@lit/context` flows downward — a consumer dispatches a bubbling `context-request` event that an _ancestor_ provider catches. `darkling-app`'s `@consumeServiceClient()` / `@consumeState()` looked up the tree for a provider, but the providers were its own children, so `serviceClient` and `state` stayed `undefined`. `guideProxy` was never built, and `handleFlush` dropped the `session_start` flush (the queue is cleared before `onFlush`), so nothing reached the Guide.

Fix: the hosts now wrap `<darkling-app>` as ancestors.
- `index.html`: `<service-bus-host><state-manager-host><darkling-app></darkling-app></state-manager-host></service-bus-host>`.
- `main.ts`: sets `options` on the `service-bus-host` and `state-manager-host` elements (instead of `busOptions`/`stateOptions` on `darkling-app`). Setting `options` after connection triggers the hosts' `updated()` → `_restartBus()` / `_restart()`, so the bus starts once configured.
- `darkling-app.ts`: dropped the `busOptions`/`stateOptions` properties and the inline `<service-bus-host>`/`<state-manager-host>` wrappers from `render()`; kept `@consumeServiceClient()` / `@consumeState()`, which now resolve against ancestor providers. The `property` import is gone (unused).

This matches the host elements' documented contract ("must be a descendant of a `<service-bus-host>`") and the spec's "hosts provide context to descendants." It also fixes the Lit update warning (the context callbacks no longer set reactive props on a parent from a child's update cycle).

### Flush holding

Previously `handleFlush` returned early (and dropped the events) when the proxy wasn't ready — but the queue is already cleared before `onFlush`, so an early `session_start` flush was lost. Now `handleFlush` holds the flushed events in `pendingFlush` and `updated()` drains them into `runGuideInteraction` once the `ServiceClient` arrives. This relies on the bus fabric queuing the `runInteraction` call during on-demand guide activation (transparent to the caller, per `service-bus.spec.md#on-demand-activation`), so the first flush is not lost if it arrives before the bus connects. `runGuideInteraction` is split out so the held flush reuses the same dispatch/release path.

### Broker not starting: reactive `options` on the host elements

After moving the hosts to `index.html` (ancestor-of-`darkling-app`), the broker worker never loaded. Root cause: `ServiceBusHost.options` / `StateManagerHost.options` were plain (non-reactive) fields documented as "set before connect." `main.ts` (a deferred module script) set them *after* the elements connected during HTML parse, but a plain field set post-connect doesn't trigger Lit's `updated()`, so `_startBus()` ran once with `options === undefined` and returned early. Fix: both `options` are now reactive Lit properties (declared imperatively via `static properties`, no decorator), so setting them post-connect triggers `updated()` → restart and the bus starts. See `packages/service-bus/package.journal.md` and `packages/state-manager/package.journal.md`.

The `SignalWatcher` double-update warning on `darkling-app` remains (it's a benign `SignalWatcher` + `@consume` construction-time interaction); `darkling-app` needs `SignalWatcher` because `render()` reads the interface-slice signal (`this.state?.get('interface')`) which must re-render on Guide-initiated `navigate` updates. The actual tablet signal-watching consumers are the `document-tablet` etc.

### End-to-end verified; 404 is expected without the backend

The full path now works in the browser: `broker starting` → `service activated {guide}` → `host launched` (guide host worker spawned on demand) → `interaction started {events: 1}` (the `session_start` flush reached the Guide) → `HttpLlmProvider` `fetch`es `/llm/turn` → `404 Not Found` (backend not running) → `provider turn failed` → `interaction ended {reason: 'budget-exhausted', consumed: 0}`. The Guide's frontend services are wired and functioning; the 404 is simply the absent backend, which the loop handles gracefully (the failed turn ends the interaction, the queue releases). Running `pnpm --filter backend dev` will resolve `/llm/turn`.

Two more bugs were fixed along the way to this state:
- `@lit/context`'s `@consume` controller calls `requestUpdate()` with no property key, so `updated()` fires but `changedProps.has('serviceClient')` is `false` — the guide-proxy branch never ran and the held `session_start` flush was never drained. Fixed by building the proxy whenever an update runs and `serviceClient` is present (not gated on `changedProps`).
- `HttpLlmProvider`/`OpenRouterLlmProvider` captured `globalThis.fetch` as a bare reference, which throws "Illegal invocation" in a Web Worker (and Node). Fixed by binding to `globalThis` (see `packages/guide/package.journal.md`).
