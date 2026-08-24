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