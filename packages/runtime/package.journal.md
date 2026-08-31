# Journal: `@darkling/runtime` package

This journal records the development of [package.spec.md](./package.spec.md) and the implementation of the `@darkling/runtime` package. It is non-normative; the specification takes precedence.

## Origin

This package consolidates the former `@darkling/service-bus` and `@darkling/state-manager` packages into a single `@darkling/runtime` package, implementing the consolidated [Runtime](../../specs/runtime.spec.md) specification.

The consolidation was motivated by the tight coupling between the service bus and state manager: the state authority was a service on the bus, and the state manager relied on the bus's execution and messaging infrastructure. The boundary was a transport-mechanism boundary within a single subsystem, not a real subsystem boundary. See [runtime.journal.md](../../specs/runtime.journal.md) for the full specification-level rationale.

## Implementation decisions

### Error hierarchy: `RuntimeError` replaces `ServiceBusError`

The former `ServiceBusError` base class is renamed to `RuntimeError`. All error subclasses (validation, host unavailable, stale basis, invariant, etc.) extend `RuntimeError`. The serialisation mechanism (`toJSON`/`fromJSON`) is preserved for cross-worker transport.

The state authority errors (`StaleBasisError`, `StateInvariantError`, `PatchNotApplicableError`) are now defined within the runtime package itself, rather than in a separate state-manager package that depends on service-bus. A new `SliceNotRegisteredError` is added for mutations targeting unregistered slices.

### `HostContext`: `client` replaces `serviceClient`; `options` removed

The `HostContext` is simplified:
- `serviceClient` is renamed to `client` (a `RuntimeClient`).
- `options` is removed entirely. Configuration flows through the initializer behaviour's parameters, per the spec.
- An optional `registryCallback` is added for the state authority to update the registry pseudo-slice. This is a runtime wiring concern, not configuration.

### `ServiceDeclaration`: behaviours, proxy factory, metadata changes

The declaration type is extended:
- `behaviours` — a record of named behaviour declarations (fire-and-forget, no return schema).
- `proxyFactory` — an optional function that produces a custom client-side proxy.
- `metadata` gains `onBroker` (boolean hint for colocated placement), `requiredSlices`, and `initializer`.
- The former `metadata.preferSharedHost` is dropped (replaced by `onBroker`).

### `MessageType`: `behaviour` added

The message type union gains `'behaviour'`. Behaviour messages are fire-and-forget: no `return` or `error` response is expected, and no correlation state is allocated by the `RuntimeClient`.

### `RuntimeClient`: behaviours, proxy factory, `registerService`

The `RuntimeClient` (formerly `ServiceClient`) is extended:
- `behaviour(service, fn, params, declaration, opts?)` — fire-and-forget dispatch. No promise, no correlation state.
- `proxy(declaration)` — uses the declaration's `proxyFactory` if present, otherwise generates a default proxy that includes both function methods (returning promises) and behaviour methods (returning void).
- `registerService(registration)` — sends a registration control message to the broker and awaits acknowledgement.
- `call` and `behaviour` accept an optional `opts?: { transfer?: Transferable[] }` for proxy factory use.

### `ServiceHost`: per-service serial processing, four-state activation, initializer

The host is substantially rewritten:
- **Per-service serial processing** uses a promise chain per service (`processingChain`). Messages are chained onto the previous one's completion, ensuring one-at-a-time processing in delivery order. Different services on the same host process concurrently (separate chains).
- **Four-state activation**: `inactive → activating_1 → activating_2 → active`. The state is determined by `metadata.requiredSlices` and `metadata.initializer`. Messages queue in `activating_1` and `activating_2`.
- **Initializer bypass**: when the initializer behaviour arrives in `activating_2`, it bypasses the queue and is delivered directly. When the initializer completes, the service transitions to `active` and queued messages are drained in order.
- **Initializer extraction**: if the initializer is already queued when the service transitions from `activating_1` to `activating_2` (via `notifySlicesLoaded`), it is extracted from the queue and delivered first.
- `notifySlicesLoaded(serviceId)` is called by the host (or external observer) when required slices become available.

### `ServiceBroker`: local host, behaviour routing, registry

The broker is rewritten:
- **Owns a local `ServiceHost`** created in `start()`. The local host is a real `ServiceHost` instance, not a special mode. Colocated services (`onBroker: true`) are activated on it.
- **Routes behaviours** as well as calls. Behaviours are routed to the host but no return is expected.
- **Registry callback**: the broker maintains a `RegistryUpdateCallback` that is wired into the local host context. The authority uses it to update the registry pseudo-slice.
- **Registration control messages**: `__registerService` is handled inline by the broker (acknowledged with a return envelope).
- The `InProcessHostSpawner` takes `ServiceRegistration[]` instead of `HostLaunchRequest[]`.

### `Runtime` facade replaces `ServiceBus`

The facade is renamed: `ServiceBus` → `Runtime`, `getServiceBus` → `getRuntime`, etc. The singleton is attached to `globalThis.__darklingRuntime`.

### State model: mutations replace patches

The `SliceDeclaration` gains a `mutations` record: named mutation declarations, each with a parameter Zod schema and a transition function (Immer recipe). The authority applies the transition using `produceWithPatches`, derives patches internally, and propagates them.

The former `SliceRegistry` and `createSliceRegistry` are removed — slices are registered dynamically via `registerSlice`. The former `computePatch` proposer helper is removed — consumers call typed mutation methods on the store, not `computePatch` + `proposeUpdate`.

### Authority: `mutate` replaces `proposeUpdate`

The authority's `proposeUpdate(proposal)` is replaced by `mutate(params)`, where params carry the slice, mutation name, mutation parameters, basis seq, and source. The authority looks up the named mutation, validates parameters, applies the transition function, validates the result, runs invariants, commits, and propagates.

`registerSlice(declaration)` is added — the authority dynamically imports the declaration module to obtain the live `SliceDeclaration`.

The registry pseudo-slice is maintained by the authority. `updateRegistry(update)` is called by the broker (via the `registryCallback`). The authority propagates registry changes via the patch channel with slice name `__registry`.

### Local copy: `getSeq` and registry support

The `LocalCopy` gains `getSeq(slice)` — returns the local copy's last-known sequence number for a slice, used by the store helper for basis-seq embedding. `getRegistry()` and `registrySignal` are added for reactive registry observation. The `SnapshotFetcher` gains `getRegistry()`.

Registry updates arrive as `__registry` patch messages; the local copy re-fetches the registry from the authority.

### Store builder

The store builder wraps raw `mutate`/`getSnapshot` calls with a typed, per-slice store. Each mutation method embeds the basis seq transparently (via `localCopy.getSeq`), retries on `StaleBasisError` (up to 5 retries), and resolves with the ack. The consumer never sees basis sequences or stale-basis errors.

The store builder is produced by the state authority's proxy factory, which returns a function taking `StateAuthorityProxyOptions` (containing a `LocalCopy`).

### State authority service

The state authority is a colocated service (`onBroker: true`) with an `initialize` behaviour (the initializer). The broadcast channel name and initial values flow through the initializer's parameters. The service exposes `mutate`, `getSnapshot`, `getRegistry`, and `registerSlice` as functions.

The `registerSlice` function dynamically imports the slice declaration module and calls `authority.registerSlice`. If an initial value was provided in the initializer, it is applied after registration.

### Lit integration: deferred

The Lit integration (`<runtime-host>` element, context keys, decorators) is deferred. The former `@darkling/service-bus/lit` and `@darkling/state-manager/lit` integrations will be consolidated into a `@darkling/runtime/lit` subpath in a follow-up.

## Gaps and open questions

- **Basis-seq convergence in store helper**: the current `mutateWithRetry` waits a fixed number of microtasks for the local copy to converge after a `StaleBasisError`. A more robust approach would observe the local copy's signal and retry when the seq changes. This is an implementation concern.
- **Host-to-host communication**: not addressed. Services on different hosts must route through the broker.
- **Slice availability notification to host**: `notifySlicesLoaded` is on the host interface but the mechanism for observing slice availability (polling the registry, observing signals) is not yet wired.
- **Worker broker factory `registerSlice`**: the worker proxy's `registerSlice` is a no-op stub. Slice registration through the worker boundary needs to be wired via a control message or authority service call.