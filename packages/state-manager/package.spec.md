# `@darkling/state-manager` package

## Purpose and scope

This specification defines the `@darkling/state-manager` package: the implementation package that provides shared live state across all execution threads.

It governs:

- the package's public API surface — the types, classes, and functions exported from the package entry point and the service subpath;
- the package's structural contract — the modules, their responsibilities, and their relationships;
- the package's dependencies and build configuration;
- the conformance of the package to [State manager](../../specs/state-manager.spec.md), which remains the normative specification for the state manager subsystem.

It is explicitly out of scope for this specification to define:

- the normative requirements of the state manager subsystem — which are defined by [State manager](../../specs/state-manager.spec.md);
- the concrete schemas and invariants of the `interface` and `session` slices — which are deferred to a refinement of [State manager](../../specs/state-manager.spec.md);
- the service bus mechanics by which the authority is invoked — which are defined by [Service bus](../../specs/service-bus.spec.md);
- the three-way interaction conflict-resolution rules — which are defined by [Three-way interaction](../../specs/three-way-interaction.spec.md).

Where this specification depends on behaviour defined by [State manager](../../specs/state-manager.spec.md), it links to it and states its requirement in terms of the package's conformance to that specification. This specification is an implementation contract: it governs how the package is structured and consumed, not the behavioural requirements of the state manager itself.

## Relationship to `specs/state-manager.spec.md`

[State manager](../../specs/state-manager.spec.md) defines the normative requirements for the state manager subsystem: the authority, the local copy, the update path, the state model, the broadcast protocol, the initialisation protocol, and the policy parameters.

This specification defines the package that implements those requirements. The package conforms to [State manager](../../specs/state-manager.spec.md); this specification does not restate or refine those normative requirements. Where the package makes an implementation decision that [State manager](../../specs/state-manager.spec.md) leaves open, that decision is recorded in [package.journal.md](./package.journal.md) and, where it has an observable effect on the package's public API, noted in this specification.

## Public API surface

The package is consumed via the main subpath (`@darkling/state-manager`) and the service subpath (`@darkling/state-manager/service`). Internal modules are not exported.

### Main subpath (`@darkling/state-manager`)

#### State model

- `SliceDeclaration` — a slice's identifier, Zod schema, and invariant functions (the erased, storage-safe form used by the registry and authority).
- `SliceDefinition<TValue>` — a typed slice definition used with `defineSlice` to author a slice with a typed schema and typed invariant functions.
- `defineSlice(definition)` — define a slice from a typed `SliceDefinition`, erasing the value type to the storage-safe `SliceDeclaration` form. Runtime-safe because the authority validates the proposed value against the schema before calling invariants.
- `SliceRegistry` — the fixed set of slice declarations, keyed by identifier.
- `createSliceRegistry(declarations)` — build a `SliceRegistry` from a fixed, ordered set of `SliceDeclaration`s. Rejects duplicate identifiers.
- `UpdateSource` — the actor proposing an update: `'ui' | 'guide' | 'service'`.
- `Patch` — an Immer patch.
- `InvariantVerdict`, `InvariantContext` — the verdict and context for slice invariant functions.

#### Authority

- `Authority` — the single process that holds the authoritative copy. Constructed with a slice registry and a `PatchChannel`. Exposes `proposeUpdate(proposal)` (serialised, validates, broadcasts, resolves with an ack) and `getSnapshot(slice)`.
- `Proposal`, `Ack` — the proposal and acknowledgement types.

#### Broadcast protocol

- `createPatchChannel(options)` — create a `PatchChannel` over a `BroadcastChannel` with the given name.
- `PatchChannel`, `PatchMessage`, `PatchChannelOptions`, `BroadcastChannelLike` — the typed channel surface.

#### Local copy

- `createLocalCopy(options)` — create a per-thread immutable snapshot of the given slices, exposed through TC39 signals.
- `LocalCopy`, `LocalCopyOptions`, `SnapshotFetcher` — the local copy surface.

#### Proposer helper

- `computePatch(base, recipe)` — compute an Immer patch against `base` using a recipe, for submission to the authority.

#### Errors

- `StaleBasisError`, `StateInvariantError`, `PatchNotApplicableError` — `ServiceBusError` subclasses raised on rejection.

### Service subpath (`@darkling/state-manager/service`)

- `declaration` — the `ServiceDeclaration` for the authority service, exposing `proposeUpdate` and `getSnapshot`. The `implementationLoader` dynamically imports the implementation module.

### Lit subpath (`@darkling/state-manager/lit`)

Lit, `@lit/context`, and `@lit-labs/signals` are optional peer dependencies of the package. The Lit subpath is imported only in projects that use Lit; it does not affect consumers of the main or service subpaths.

- `StateManagerHost` — a `<state-manager-host>` custom element that owns a `LocalCopy`, consumes the `ServiceClient` from the nearest ancestor `<service-bus-host>` (provided by `@darkling/service-bus/lit`), builds a `SnapshotFetcher` from it, creates a `PatchChannel`, fetches the initial snapshots on connect, and provides the `LocalCopy` to descendant elements via Lit's context mechanism. Disposed on disconnect. The `options` property is a reactive Lit property (set before or after connect; setting it while connected restarts the local copy), declared imperatively via `static properties` (no decorator, for decorator-config compatibility).
- `StateManagerHostOptions` — the options for the host element: the slices to consume and the `BroadcastChannel` name.
- `createBusSnapshotFetcher(client, declaration?)` — build a `SnapshotFetcher` from a `ServiceClient` by creating a typed proxy to the authority service. Exported for use outside a `<state-manager-host>` (e.g. in a worker).
- `stateClientContext` — the Lit context key for the `LocalCopy`.
- `consumeState()` — a property decorator consuming the `LocalCopy` from the nearest `<state-manager-host>`.
- `useState(host, callback)` — a hook for consuming the `LocalCopy` without a decorator.
- `SignalWatcher`, `watch`, `Signal` — re-exported from `@lit-labs/signals` / `signal-polyfill`, so consumer elements render shared state reactively with the TC39 signals they already read from the `LocalCopy`. A consumer mixes in `SignalWatcher` and renders a slice's signal via `watch(localCopy.signal(slice))` so that broadcast patches trigger re-renders.

## Structural contract

The package is organised into the following modules:

- `model.ts` — slices, schemas, invariants, the slice registry.
- `errors.ts` — `ServiceBusError` subclasses for rejection.
- `broadcast.ts` — the `PatchChannel` over a `BroadcastChannel`.
- `authority.ts` — the `Authority`: serialised update processing, validation, broadcast.
- `local-copy.ts` — the `LocalCopy`: immutable snapshot, patch application, gap recovery, TC39 signals.
- `propose.ts` — the `computePatch` proposer helper.
- `service-declaration.ts` — the service declaration (entry point of `./service`).
- `service-implementation.ts` — the service implementation, loaded lazily by the declaration.
- `index.ts` — the public API entry point.

## Dependencies

The package depends on:

- `zod` (v4) — slice schemas and validation.
- `immer` — patches: `produceWithPatches`, `applyPatches`, `enablePatches`.
- `signal-polyfill` — TC39 signals reactivity: `Signal.State`.
- `@darkling/service-bus` (workspace) — `ServiceDeclaration`, `ServiceImplementation`, `ServiceBusError`.

The Lit subpath additionally uses optional peer dependencies:

- `lit` — `LitElement`, for the `<state-manager-host>` custom element.
- `@lit/context` — context provider/consumer for the `LocalCopy`.
- `@lit-labs/signals` — `SignalWatcher` mixin and `watch` directive, integrating TC39 signals into Lit's reactive update lifecycle.

## Conformance

The package conforms to [State manager](../../specs/state-manager.spec.md):

- the `Authority` runs as a single serialising process and is exposed as a service on the [Service bus](../../specs/service-bus.spec.md) via `proposeUpdate` and `getSnapshot`;
- `proposeUpdate` is serialised per slice, enforces schema validity and slice invariants, and rejects with `StaleBasisError` on a stale basis;
- accepted patches are broadcast over a `PatchChannel` (a `BroadcastChannel`) with monotonic per-slice sequence numbers;
- local copies fetch initial snapshots on boot, apply patches in sequence, recover from gaps via `getSnapshot`, and expose reads through TC39 signals;
- rejected proposals reject the bus call and are never broadcast.