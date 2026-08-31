# `@darkling/runtime` package

## Purpose and scope

This specification defines the `@darkling/runtime` package: the implementation package that provides the runtime as a consumable library.

It governs:

- the package's public API surface — the types, classes, and functions exported from the package entry point;
- the package's structural contract — the modules, their responsibilities, and their relationships;
- the package's dependencies and build configuration;
- the conformance of the package to [Runtime](../../specs/runtime.spec.md), which is the normative specification for the runtime subsystem.

It is explicitly out of scope for this specification to define:

- the normative requirements of the runtime subsystem — which are defined by [Runtime](../../specs/runtime.spec.md);
- the specific services that run on the runtime — which are defined by their respective domain specifications;
- the behaviour of the constrained agent, content model, or retrieval — which are defined by their respective specifications.

## Relationship to `specs/runtime.spec.md`

[Runtime](../../specs/runtime.spec.md) defines the normative requirements for the runtime subsystem: the `ServiceBroker`, `ServiceHost`, and `RuntimeClient` architecture; service registration, on-demand activation, and initialization; the service interface contract; the message envelope; Transferable object handling; shared state; and the declaration-driven programming model.

This specification defines the package that implements those requirements. The package conforms to [Runtime](../../specs/runtime.spec.md); this specification does not restate or refine those normative requirements. Where the package makes an implementation decision that [Runtime](../../specs/runtime.spec.md) leaves open, that decision is recorded in [package.journal.md](./package.journal.md).

## Public API surface

The package exports its public API from a single entry point (`./src/index.ts`, mapped as `.` in `package.json` `exports`). Internal modules are not exported; consumers depend only on the public API.

### Envelope types

- `Envelope`, `EnvelopeHead` — SOAPjr-style message envelopes.
- `MessageType` — `'call' | 'behaviour' | 'return' | 'error'`.
- `ServiceId`, `FunctionName`, `MessageId`, `TransferableRef` — string-branded type aliases.

### Declaration types

- `ServiceDeclaration` — a service's interface and metadata, including functions, behaviours, implementation loader, optional proxy factory, and metadata (`onBroker`, `requiredSlices`, `initializer`).
- `ServiceFunctionDeclaration`, `ServiceBehaviourDeclaration` — function and behaviour declarations with Zod schemas.
- `ServiceMetadata` — service-level metadata for routing and activation.
- `ServiceInterface<T>`, `ServiceBehaviourInterface<T>` — mapped types deriving typed methods.

### Registration types

- `ServiceRegistration` — serializable service registration (ID + module specifier + metadata).
- `SliceRegistration` — serializable slice registration (ID + module specifier).
- `RegistryValue` — the registry pseudo-slice value.
- `EMPTY_REGISTRY` — the initial empty registry value.

### Transport

- `Transport`, `TransportPair` — message transport abstraction.
- `createInProcessTransportPair()` — in-process transport for testing.
- `createWorkerTransport(worker, options)` — transport backed by a Web Worker or `MessagePort`.

### Errors

- `RuntimeError` — base error type, with `toJSON`/`fromJSON` for cross-worker serialisation.
- `ValidationError`, `ReturnValidationError`, `HostUnavailableError`, `ServiceNotRegisteredError`, `FunctionNotDeclaredError` — service execution errors.
- `StaleBasisError`, `StateInvariantError`, `PatchNotApplicableError`, `SliceNotRegisteredError` — state authority errors.
- `deserialiseError`, `isRuntimeErrorSerialised` — error deserialisation utilities.

### RuntimeClient

- `RuntimeClient` — the caller-side component. Creates typed proxies (using proxy factory if present), handles promise resolution, exposes `call`/`behaviour` low-level dispatch, and `registerService`.

### ServiceHost

- `ServiceHost` — the host-side component. Manages activation, initialization, per-service serial processing, and the initializer protocol.
- `HostInterface` — the uniform interface presented to the broker.

### ServiceImplementation

- `ServiceImplementation` — abstract base class for service implementations.
- `HostContext` — context provided to implementations (`client`, `registryCallback`).
- `ServiceCallContext` — per-call context.

### ServiceBroker

- `ServiceBroker` — the central routing and coordination point. Owns a local `ServiceHost`, manages remote hosts, routes messages, maintains the service registry.
- `InProcessHostSpawner` — in-process host spawner for testing.
- `HostSpawner` — the spawner interface.
- `ServiceModuleResolver` — resolver for in-process declaration loading.

### Runtime facade

- `Runtime` — the main-thread facade. Creates and owns the `ServiceBroker`, exposes the `RuntimeClient`.
- `createInProcessBrokerFactory(resolver, hostContext)` — in-process broker factory for testing.
- `getRuntime`, `peekRuntime`, `resetRuntime` — singleton management.

### Worker spawner and broker factory

- `WorkerHostSpawner` — launches hosts in dedicated Web Workers.
- `createWorkerBrokerFactory(options)` — runs the broker in a dedicated Web Worker.

### Worker protocol types

- `BrokerWorkerInit`, `BrokerWorkerRegister`, `HostWorkerInit`, `HostWorkerReady`, `HostWorkerError`, `WorkerControlMessage`, `WorkerUrl` — worker control message types.

### State model

- `SliceDeclaration`, `SliceDefinition`, `SliceMutationDeclaration` — slice and mutation declarations.
- `defineSlice(definition)` — define a typed slice, erasing to the storage-safe form.
- `UpdateSource`, `Patch`, `InvariantVerdict`, `InvariantContext` — state model types.

### Authority

- `Authority` — the state authority. Processes mutations, enforces invariants, propagates changes.
- `MutationParams`, `Ack`, `Snapshot` — authority types.

### Broadcast

- `createPatchChannel(options)` — create a `PatchChannel` over a `BroadcastChannel`.
- `PatchChannel`, `PatchMessage`, `PatchChannelOptions`, `BroadcastChannelLike` — the typed channel surface.

### Local copy

- `createLocalCopy(options)` — create a per-thread reactive snapshot.
- `LocalCopy`, `LocalCopyOptions`, `SnapshotFetcher` — local copy types.

### Store builder

- `createStoreBuilder(client, localCopy, authorityServiceId)` — create a store builder from a `RuntimeClient` and `LocalCopy`.
- `StoreBuilder`, `SliceStore` — the store builder and per-slice store types.

### Subpaths

The package also exports:

- `./broker-worker` — the broker worker entry point.
- `./host-worker` — the host worker entry point.
- `./state-authority-service` — the state authority service declaration (default export).

## Structural contract

The package is organised into the following modules:

- `envelope.ts` — message envelope types.
- `declaration.ts` — service declaration types.
- `registration.ts` — registration types and the registry pseudo-slice value.
- `transport.ts` — the `Transport` interface.
- `in-process-transport.ts` — in-process transport pair for testing.
- `worker-transport.ts` — transport backed by a Web Worker.
- `errors.ts` — the error hierarchy.
- `runtime-client.ts` — the `RuntimeClient`.
- `service-host.ts` — the `ServiceHost` with activation, serialisation, and initializer protocol.
- `service-implementation.ts` — the `ServiceImplementation` base class and `HostContext`.
- `service-call-context.ts` — per-call context.
- `service-broker.ts` — the `ServiceBroker` with local host, registry, and routing.
- `runtime.ts` — the `Runtime` facade and singleton.
- `worker-host-spawner.ts` — worker-based host spawner.
- `worker-broker-factory.ts` — worker-based broker factory.
- `worker-protocol.ts` — worker control message types.
- `broker-worker.ts` — broker worker entry point.
- `host-worker.ts` — host worker entry point.
- `state-model.ts` — slices, schemas, mutations, invariants.
- `authority.ts` — the `Authority`: mutation processing, invariants, propagation.
- `broadcast.ts` — the `PatchChannel` over a `BroadcastChannel`.
- `local-copy.ts` — the `LocalCopy`: immutable snapshot, patch application, gap recovery, signals.
- `store-builder.ts` — the store builder and typed store.
- `state-authority/service-declaration.ts` — the state authority service declaration (with proxy factory).
- `state-authority/service-implementation.ts` — the state authority service implementation.

## Dependencies

- `@darkling/observability` (workspace:*) — logging.
- `immer` — patch generation and application.
- `signal-polyfill` — TC39 signals.
- `zod` — schema validation.