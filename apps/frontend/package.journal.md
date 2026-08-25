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
