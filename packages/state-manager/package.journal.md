# `@darkling/state-manager` package — journal

## Creation

Created as the implementation package for `specs/state-manager.spec.md`, following the established one-package-per-spec-area pattern. The package is a neutral infrastructure mechanism, consumed by the UI, Guide, and services.

## Decisions

### Library choices

- **Immer** (`immer` v10) for patches: `produceWithPatches` (proposer side), `applyPatches` (authority + local copy), `enablePatches` (called once on module load in `authority.ts` and `local-copy.ts`). Immer's `Patch` type (`{ op, path, value? }`) matches the spec's patch format.
- **signal-polyfill** (`signal-polyfill` v0.2.2) for TC39 signals reactivity. Uses `Signal.State<T>` as the per-slice signal; consumers read via `signal.get()` and subscribe via `Signal.Computed`/`Signal.subtle.Watcher`. The spec leaves subscription granularity to implementation; the package uses one `Signal.State` per slice, set to the new immutable value on each patch. No `effect` API is provided by `signal-polyfill` v0.2.2; consumers compose `Signal.Computed` + `Signal.subtle.Watcher` or supply their own effect runner. This is consistent with the spec's "compatible with the TC39 signals proposal" requirement and its deliberate non-mandating of granularity.

### Authority: per-slice serialisation via in-process queues

The spec requires the authority to serialise `proposeUpdate` calls (process one at a time, completing validation and broadcast before the next). The implementation uses an in-process per-slice promise queue (`enterQueue`/`exitQueue`): the first call proceeds immediately; subsequent calls await a resolver pushed onto the queue and are released in arrival order by `exitQueue`. Serialisation is per-slice, since slices are independently versioned and updates to different slices don't contend. This is an implementation choice; the spec permits any serialisation strategy as long as arrival order is preserved per slice.

### Authority: lazy ValidationError import

The authority throws the service-bus `ValidationError` for schema failures so the host serialises them with the canonical `VALIDATION_ERROR` code. `ValidationError` is imported at the bottom of `authority.ts` rather than at the top, purely for readability; it is a static import, not lazy at runtime. The host's existing catch-by-name (`error instanceof ValidationError`) handles it.

### Authority: `init()` for initial values

The spec defines slice initial value as sequence 0 but doesn't specify how the authority obtains it. The package adds an `init(slice, value)` method on `Authority`, called by `StateManagerService` from the host-provided `initialValues` map. Slices without an initial value default to `undefined` at sequence 0. This is an implementation decision; recorded here.

### Local copy: signals granularity = one `Signal.State` per slice

The spec leaves subscription granularity open. The package uses one `Signal.State<unknown>` per slice, set to the new immutable snapshot value on each accepted patch. Consumers read via `localCopy.get(slice)` (which calls `signal.get()`) or `localCopy.signal(slice)` for direct signal access. A `Signal.Computed` reading `get(slice)` re-evaluates when the slice's signal is set. This is the simplest granularity that satisfies the spec; finer per-path granularity could be added later without changing the public API.

### Local copy: patch-application failure triggers re-fetch

The spec defines gap recovery for sequence gaps. The package additionally treats a failed `applyPatches` (malformed/incompatible patch) as a recovery trigger: it re-fetches via `getSnapshot` and resumes from the fresh sequence, mirroring gap recovery. This is defensive and not strictly required by the spec; recorded here.

### Local copy: re-fetch failure handling

If a `getSnapshot` re-fetch fails, the local copy leaves the slice at its last-known sequence and relies on a subsequent gap to trigger retry. The spec leaves backoff/retry of `getSnapshot` to implementation; the package does not implement backoff.

### Service options injection via `hostContext.stateManager`

Following the `guide` package's pattern (`hostContext.guide`), the state manager service reads its options from `hostContext.stateManager`. This lets the host inject the slice registry, broadcast channel name, initial values, and an optional `BroadcastChannel` factory (for tests) at construction time.

### `computePatch` proposer helper

The package exports a `computePatch(base, recipe)` helper that wraps Immer's `produceWithPatches`, returning the resulting value, patches, and inverse. This gives proposers a convenient way to generate patches against their last-known snapshot. The spec doesn't mandate a proposer helper; it's a convenience that keeps proposers from importing Immer directly.

## Gaps and open questions

- **No `effect` API**: `signal-polyfill` v0.2.2 provides `Signal.State` and `Signal.Computed` but no `effect`. Consumers needing effect-style subscription must compose `Signal.Computed` + `Signal.subtle.Watcher` or provide their own effect runner. If a higher-level reactivity API is needed, it would be a consumer concern, not a state-manager concern.
- **Concrete slice schemas** remain deferred to a refinement of the root spec, as the root spec's journal records. This package's tests use a trivial `z.unknown()` slice.
- **Authority persistence/failover** is not implemented; the authority is in-memory. Cross-session continuity is out of scope for this package.
- **The `getSnapshot` bus function is per-slice.** A batched "get all snapshots" function is not provided; the root spec speaks of per-slice fetches.

## Lit integration (`@darkling/state-manager/lit`)

Added a Lit integration subpath, mirroring the `@darkling/service-bus/lit` pattern (optional `lit`/`@lit/context`/`@lit-labs/signals` peer deps; `./lit` export). It integrates the TC39 signals already used by `LocalCopy` into Lit's reactive update lifecycle via `@lit-labs/signals`.

### Components

- **`<state-manager-host>`** (`StateManagerHost`) — a `LitElement` that owns a `LocalCopy`. It consumes the `ServiceClient` from the nearest ancestor `<service-bus-host>` via `@lit/context` (`serviceClientContext` re-exported from `@darkling/service-bus/lit`), builds a `SnapshotFetcher` via `createBusSnapshotFetcher`, creates a `PatchChannel`, fetches initial snapshots on connect, and provides the `LocalCopy` to descendants via `stateClientContext`. Disposed on disconnect. Defined imperatively (no TS decorators), consistent with `ServiceBusHost`.
- **`createBusSnapshotFetcher(client, declaration?)`** — builds a `SnapshotFetcher` from a `ServiceClient` by creating a typed proxy to the authority service's `getSnapshot`. Exported separately so a fetcher can be built outside a `<state-manager-host>` (e.g. in a worker that has a `ServiceClient` but no DOM).
- **`stateClientContext`** / **`@consumeState()`** / **`useState(host, cb)`** — the Lit context key, decorator, and hook for consuming the `LocalCopy`, mirroring `serviceClientContext` / `consumeServiceClient` / `useServiceClient` in the service-bus lit integration.
- **Re-exports `SignalWatcher`, `watch`, `Signal`** from `@lit-labs/signals` / `signal-polyfill` for one-stop importing. A consumer mixes in `SignalWatcher(LitElement)` and renders `watch(localCopy.signal(slice))`; when the `LocalCopy` sets the slice's signal on a broadcast patch, `@lit-labs/signals` triggers a re-render.

### Decisions

- **Optional peer deps, not hard dependencies.** `lit`, `@lit/context`, `@lit-labs/signals` are optional peers (like the service-bus lit subpath), so the main and service subpaths don't pull Lit into non-Lit consumers (e.g. the Guide worker). `@lit-labs/signals` was moved out of `dependencies` to `peerDependencies` accordingly.
- **No DOM test environment.** The repo's vitest config has no DOM environment (no jsdom/happy-dom installed), and the service-bus lit integration is typed but not DOM-tested. Following that precedent, the element/consumer integration is verified by typecheck and example, and the testable non-DOM units (`createBusSnapshotFetcher`, context key identity) are covered in `test/lit-integration.test.ts`. A future refinement could add a DOM test environment if Lit element behaviour needs runtime verification.
- **`createContext` string-key identity.** `@lit/context`'s `createContext(name)` with a string key returns a value equal by strict equality to that string, so `stateClientContext === 'darkling-state-manager:local-copy'`. The test asserts this identity directly.
## `StateManagerHost.options` is now a reactive property

Mirrors the `ServiceBusHost.options` change (see `packages/service-bus/package.journal.md`). The `options` field was a plain non-reactive field documented as "set before the element connects"; setting it after connection (as the frontend now does, with the host in `index.html`) didn't trigger `updated()` → `_restart()`. Now `options` is a reactive Lit property declared via `static properties = { options: { type: Object } }` (imperative, no decorator), so setting it post-connect triggers the restart handler and the local copy starts once configured.
