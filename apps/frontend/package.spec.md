# `frontend` app

## Purpose and scope

This specification defines the `frontend` app: the Vite/Lit single-page application that runs the Darkling UI, the Guide agent loop, and the retrieval/cache worker across Web Workers, and bootstraps the service bus and state manager on page load.

It governs:

- the app's structural contract — the modules, the worker entry points, and the bootstrap sequence;
- the worker topology — the broker, Guide, and retrieval workers, their registration, and the main-thread host elements;
- the event system — the UI event queue, the per-event probabilistic flush policy, and interaction triggering, as defined by [Event system](../../specs/event-system.spec.md);
- the UI — the 3D scene, the tablet stack, the Guide's avatar, the non-document tablets, the address input, and the high-level semantic event production, as defined by [User interface](../../specs/ui.spec.md);
- the UI-control and avatar-interaction tools — the `navigate`, `draw_attention`, `speak`, `set_avatar_position`, `set_avatar_visibility`, and `animate_avatar` tools registered on the bus, as defined by [User interface](../../specs/ui.spec.md);
- the conformance of the app to [Usage and deployment](../../specs/usage-and-deployment.spec.md), [Event system](../../specs/event-system.spec.md), [Constrained agent](../../specs/constrained-agent.spec.md), [User interface](../../specs/ui.spec.md), and [State manager](../../specs/state-manager.spec.md).

It is explicitly out of scope for this specification to define:

- the normative requirements of the subsystems — which are defined by their respective root specifications;
- the service bus, state manager, guide agent loop, and knowledge-base retrieval internals — which are defined by their packages;
- the backend — which is defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md) and the `backend` app;
- the specific 3D rendering library — which is an implementation concern; the initial implementation uses CSS 3D transforms.

## Bootstrap sequence

On page load, the frontend bootstraps the runtime, as defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md#bootstrap-sequence):

1. The service bus is created and started, with the broker in its Web Worker.
2. The retrieval service is registered on the bus (running in a worker), connecting to the backend over HTTP.
3. The Guide agent loop service is registered on the bus (running in a worker).
4. The state manager authority service is registered on the bus (running in a worker).
5. The UI-control and avatar-interaction tools are registered on the bus.
6. The UI is mounted on the main thread, producing events as the Visitor interacts.
7. The UI emits `session_start` (trigger probability 1.0), flushing the event queue and triggering the Guide's first interaction, as defined by [User interface](../../specs/ui.spec.md#session-start).

## Structural contract

The app is organised into the following modules:

- `src/index.ts` — the app entry: bootstrap the bus, register services, mount the UI.
- `src/workers/broker-worker.ts` — the service bus broker worker entry point.
- `src/workers/host-worker.ts` — the generic service-bus host worker entry point (shared by all worker-hosted services).
- `src/workers/guide-declaration.ts` — the frontend Guide service declaration, whose `implementationLoader` dynamically imports `./guide-service.ts`. The wire contract mirrors `@darkling/guide`'s `runInteraction` schemas.
- `src/workers/guide-service.ts` — the frontend Guide service implementation (`FrontendGuideService`): constructs the loop's `HttpLlmProvider`, `ToolRegistry` (agent-self tools), and `BudgetTracker` from serialisable config carried across the worker boundary via the service registration's `options` bag, then delegates to `@darkling/guide`'s `GuideService`.
- `src/workers/retrieval-declaration.ts` — re-exports the knowledge-base retrieval service declaration.
- `src/workers/state-manager-declaration.ts` — re-exports the state-manager service declaration.
- `src/events/event-queue.ts` — the event queue and per-event probabilistic flush policy, as defined by [Event system](../../specs/event-system.spec.md).
- `src/events/event-types.ts` — the high-level semantic event types and payloads, as defined by [User interface](../../specs/ui.spec.md#events).
- `src/tools/ui-control-tools.ts` — the `navigate` and `draw_attention` tools, as defined by [User interface](../../specs/ui.spec.md#ui-control-tools).
- `src/tools/avatar-tools.ts` — the `speak`, `set_avatar_position`, `set_avatar_visibility`, and `animate_avatar` tools, as defined by [User interface](../../specs/ui.spec.md#avatar-interaction-tools).
- `src/ui/darkling-app.ts` — the root `<darkling-app>` element that hosts the scene, the bus, and the state manager.
- `src/ui/scene.ts` — the 3D scene (ground plane, overlay plane, tablet stack).
- `src/ui/document-tablet.ts` — a document tablet (one document, continuous Markdown, focusable blocks).
- `src/ui/non-document-tablet.ts` — the ToC and search tablets, minimisable to the icon rail.
- `src/ui/guide-avatar.ts` — the Guide's avatar (figure, speech, position, visibility, animation).
- `src/ui/address-input.ts` — the address input for `direct_address` events.

## Dependencies

The app depends on:

- `lit` — the UI framework.
- `@darkling/service-bus` (workspace) — the service bus, worker transport, lit host element.
- `@darkling/guide` (workspace) — the Guide agent loop, LLM provider, tool registry.
- `@darkling/knowledge-base` (workspace) — the retrieval service declaration.
- `@darkling/state-manager` (workspace) — the shared-state authority, local copy, lit host element.
- `@lit/context`, `@lit-labs/signals` — Lit context and signals integration.
- `zod` (v4) — tool parameter schemas.
- `immer` — patch computation for `interface` slice proposals.

## Rendering

The UI is rendered with CSS 3D transforms: the scene is a perspective container; tablets are DOM elements positioned in 3D space with `transform: translateZ()` and `rotateY()` for depth and tilt; the ground plane is a `rotateX(90deg)` element; the overlay plane (avatar + icon rail) sits above the topmost tablet. This avoids a WebGL dependency while presenting the spatial model defined by [User interface](../../specs/ui.spec.md#scene). The rendering approach is an implementation concern; the spec requires only the spatial model and that UI logic runs on the main thread.