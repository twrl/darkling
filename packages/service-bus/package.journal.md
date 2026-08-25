# Journal: `@darkling/service-bus` package

This journal records the development of the `@darkling/service-bus` package — the implementation of [service-bus.spec.md](../../specs/service-bus.spec.md) as defined by [package.spec.md](./package.spec.md). It is non-normative; the specifications take precedence.

## Worker-protocol extension: serialisable per-service construction options

Established through dialogue with the user while wiring the Guide's frontend services. The Guide service (`@darkling/guide`'s `GuideService`) reads `GuideServiceOptions` (LLM provider, tool registry, budget policy) from its `HostContext` at construction time, but the worker protocol previously carried only `{ serviceId, moduleSpecifier }` on `ServiceRegistration`/`HostLaunchRequest`/`HostWorkerInit`, and `HostContext` exposed only `serviceClient`. There was no path for the main thread to hand construction config to a worker-hosted service.

The user chose to extend the worker protocol rather than add a frontend-specific guide worker. The extension:

- **`ServiceRegistration.options?: Record<string, unknown>`** — an optional structured-cloneable construction-options bag for the service (the service's own options, not keyed by service ID), set by the main thread. The broker forwards it onto the `HostLaunchRequest`.
- **`HostLaunchRequest.options?`** — forwarded by the broker's `ensureHostForService` from the registration.
- **`HostWorkerInit.services[i].options?`** — the host worker (and the in-process `InProcessHostSpawner`) keys each service's options by service ID and merges them into `HostContext.options`: `options[serviceId] = serviceOptions`.
- **`HostContext.options?: Record<string, unknown>`** — a new index-signature bag keyed by service ID. A service implementation reads its options at construction time (e.g. `hostContext.options?.guide`); `GuideService` and `KnowledgeBaseService` now read from `hostContext.options?.<serviceId>` with a fallback to the previous top-level `hostContext.<serviceId>` form, so in-process tests that set `hostContext.guide`/`hostContext.knowledgeBase` directly still work.

The values must be structured-cloneable (numbers, strings, plain objects/arrays); non-serialisable objects (functions, live Zod schemas, `ToolRegistry`/`LlmProvider` instances) must not be placed here. The Guide worker constructs its `HttpLlmProvider`, `ToolRegistry`, and `BudgetTracker` from this serialisable config inside the worker — that construction lives in the frontend (a frontend guide service implementation), not in `@darkling/guide`, which keeps `GuideService` provider/registry-agnostic as its package spec requires.

The root spec ([Service bus — Declaration module and implementation loading](../../specs/service-bus.spec.md#declaration-module-and-implementation-loading)) says the host "instantiates the constructor with a `HostContext`, injecting bus access at construction time" and does not constrain what else `HostContext` may carry, so this extension conforms; it does not modify the root spec.

## Origin

Created as the first implementation package, in response to a request to "make a start on implementation." The service bus was chosen as the starting point because it is infrastructure that the constrained agent, retrieval, and event system all depend on, and it can be implemented and tested independently of the content model.

## Scope decisions

- **One package per spec area.** The package layout mirrors the specification boundaries: `packages/service-bus` implements [service-bus.spec.md](../../specs/service-bus.spec.md). This keeps each package's conformance surface mapped to a single specification.
- **Transport abstraction.** The spec describes `postMessage`-based communication between Web Workers. Rather than coupling the broker, host, and client directly to the `Worker` API, a `Transport` interface abstracts the message channel. This allows the bus to operate over real Web Workers (`createWorkerTransport`), `MessagePort`s, or an in-process mock (`createInProcessTransportPair`) for testing. The spec's normative requirements are stated in terms of envelopes and message passing, not the `Worker` API directly, so this abstraction is conformant.
- **Host spawner abstraction.** The spec states "the broker decides when to launch a new host" but leaves the launch mechanism to implementation. A `HostSpawner` interface abstracts host creation, with an `InProcessHostSpawner` for testing. A real Web Worker spawner can be added without changing the broker.

## Key decisions and rationale

### In-process transport for testing

`createInProcessTransportPair` produces two `Transport` endpoints connected by `queueMicrotask`. Messages sent on one end are received on the other after the current execution context completes, approximating the async delivery semantics of `postMessage` without requiring actual workers. This lets the full broker → host → client round-trip be tested in a single Node.js process.

### Typed proxies from Zod schemas

The `ServiceClient.createProxy` method constructs a proxy from a `ServiceDeclaration` at runtime, with each function delegating to `ServiceClient.call`. Parameter and return validation is performed at the call site (proxy-side) using the declared Zod schemas, providing early validation and end-to-end type safety as permitted (but not required) by the spec. The proxy provides compile-time types via `ServiceInterface<T>`, which maps declared function names to typed methods derived from the schemas.

### Validation at both proxy and host

The spec requires validation at the broker/host boundary (parameters before dispatch, returns before sending back). The implementation validates at both the proxy (call site) and the host, providing defence in depth. The proxy validation is optional per the spec ("a proxy may validate"); the host validation is normative.

### Structured error hierarchy

The spec's journal notes an undefined error taxonomy. The implementation defines a `ServiceBusError` base class with subclasses for `ValidationError`, `ReturnValidationError`, `HostUnavailableError`, `ServiceNotRegisteredError`, and `FunctionNotDeclaredError`. Errors are serialised to plain objects for transport across worker boundaries and deserialised on the client side via `deserialiseError`.

#### Host serialises all `ServiceBusError` subclasses, not just `ValidationError`

The host's `catch` block originally special-cased `ValidationError` (calling `toJSON()`) and serialised every other thrown error as a generic `{ code: 'SERVICE_ERROR' }`. This dropped the `code` of any other `ServiceBusError` subclass thrown by a service implementation (e.g. the state manager's `StaleBasisError` / `StateInvariantError`), round-tripping them as generic `SERVICE_ERROR`s. Changed the catch to serialise any `ServiceBusError` via `toJSON()`, preserving the subclass `name` and `code` across the worker boundary. `ValidationError` continues to round-trip correctly since it extends `ServiceBusError`. Non-`ServiceBusError` throws still fall back to the generic `SERVICE_ERROR` shape. This is a general improvement that lets any service throw typed `ServiceBusError` subclasses and have their codes survive the boundary, which the `state-manager` authority relies on.

### Call timeout as host-failure detection

The spec requires the `ServiceClient` to reject the caller's promise if a host is unavailable or fails to respond. The implementation uses a configurable call timeout (default 30s) as the host-failure detection mechanism: if no `return` or `error` message arrives within the timeout, the promise is rejected with `HostUnavailableError`.

### Broker routing policy: dedicated host per service

The spec states the broker decides when to launch a new host versus activating a service on an existing host, informed by service metadata. The initial implementation launches a dedicated host per service. The `preferSharedHost` metadata flag is read but full shared-host activation is not yet implemented — the broker falls through to launching a new host. This is a minimal conformant policy; the spec does not prescribe the policy, only that the broker makes the decision.

### Envelope transfer handled transparently

The `transferables` field in the envelope head is passed through verbatim. `createWorkerTransport` passes the resolved transferables as the `transfer` parameter to `postMessage`. The in-process transport ignores transferables (no ownership transfer semantics in-process). The service interface remains transparent to the transfer mechanism, as required.

### Worker entry point subpath exports

The package spec states that the worker entry points (`broker-worker.ts`, `host-worker.ts`) "are not exported from the package index (they are worker scripts, not library API)" and are "consumed by bundlers as worker entry points via `new Worker(new URL('./broker-worker.ts', import.meta.url))`". This pattern works when the consumer can resolve a relative URL to a file within the same package, but when a separate package (e.g. the frontend) imports the worker entry point via a bare specifier (`@darkling/service-bus/src/broker-worker.js`), Vite's resolver rejects it because `src/broker-worker.ts` is not in the package's `exports` map.

**Decision:** Added `./broker-worker` and `./host-worker` subpath exports to `package.json`, mapping to `./src/broker-worker.ts` and `./src/host-worker.ts` respectively. The frontend's worker wrapper files (`apps/frontend/src/workers/broker-worker.ts`, `host-worker.ts`) now import via these subpaths (`@darkling/service-bus/broker-worker`, `@darkling/service-bus/host-worker`). The spec's statement that the entry points are "not exported from the package index" remains true — they are not in the `.` barrel; the subpaths are separate export entries for the worker scripts. The spec's `new URL('./broker-worker.ts', import.meta.url)` example describes the main-thread side (creating the `Worker` from a URL); the subpath export is needed for the worker-side `import` of the service-bus worker script. This is a package-consumption concern, not a spec change.

## Gaps and ambiguities

- **Shared-host activation.** The `preferSharedHost` metadata flag is declared but the broker does not yet activate a service on an existing compatible host; it always launches a new host. This is a policy refinement to implement when multi-service hosts are needed.
- **Host deactivation.** The spec permits hosts to be deactivated when idle. The broker does not yet deactivate idle hosts. This is an implementation concern deferred until worker lifecycle management is needed.
- **Web Worker host spawner.** Only `InProcessHostSpawner` is implemented. A `WorkerHostSpawner` that creates real Web Workers and connects them via `createWorkerTransport` is needed for production use.
- **Schema transport.** Service declarations carry Zod schema objects, which are not serialisable across worker boundaries. The current in-process spawner passes declarations by reference. A worker-based spawner will need to handle schema transport (e.g. serialised JSON Schema, or loading declaration modules in the worker).
- **Host-to-host communication.** The spec's journal notes host-to-host communication is undefined. The current implementation routes all communication through the broker; services can call other services via a `ServiceClient` (available within a host), but this requires the host to have its own `ServiceClient` connected to the broker — not yet wired up.
- **Service-to-service calls.** The spec states the `ServiceClient` is available within service hosts. The current `ServiceHost` does not provide a `ServiceClient` to service functions; the `ServiceCallContext` would need to be extended to carry one. Deferred until a service needs to call another service.
- **Message ordering.** The spec does not address message ordering guarantees. The in-process transport uses `queueMicrotask`, which preserves send order per endpoint. Real worker transports inherit `postMessage` ordering. This is not normatively stated but holds in practice.

## Package specification established

[package.spec.md](./package.spec.md) was created to govern the package as a consumable unit — its public API surface, module structure, dependencies, and build configuration — distinct from the normative [service-bus.spec.md](../../specs/service-bus.spec.md) which governs the subsystem's behavioural requirements. The journal was renamed from `journal.md` to `package.journal.md` to match the `*.spec.md` / `*.journal.md` pairing convention.

The package spec documents the implementation abstractions not named by the root spec — `Transport`, `HostSpawner`, and the error hierarchy — as part of the package's implementation contract. These are conformant additions: the root spec leaves them open ("an implementation concern", "does not define an error taxonomy"), and the package spec makes them observable so that consumers can depend on them.

## Bootstrap sequence analysis

A review of the main-thread bootstrap sequence against the spec's worker topology ([Service bus](../../specs/service-bus.spec.md#worker-topology)) exposed five problems with the current implementation. The spec requires the broker and each host to run in separate Web Workers, with the `ServiceClient` on the caller's thread. The current in-process implementation sidesteps this, which is fine for tests but means there is no conformant bootstrap path.

### Problem 1 — Registration mixes declaration and implementation

`ServiceBroker.register(declaration, implementation)` couples the broker to implementations. The spec states that the declaration is registered with the broker and the implementation runs on a host — they are separate ([Service registration](../../specs/service-bus.spec.md#service-registration)). The broker should only hold declarations; the `HostSpawner` should resolve implementations for given service IDs.

**Decision:** Split registration. The broker holds declarations only. A separate `ServiceModuleRegistry` maps service IDs to module specifiers. The `HostSpawner` uses this registry to resolve implementations. Module specifiers + dynamic import was chosen as the resolution mechanism: the host worker dynamically imports the implementation modules, which also lets it import the declaration modules so schemas are live Zod instances (avoiding the schema transport problem).

### Problem 2 — No worker-based host spawner (deferred)

Only `InProcessHostSpawner` exists. A `WorkerHostSpawner` would create a `Worker`, send it service IDs to activate, have the worker import implementation modules, construct a `ServiceHost`, and wire a transport. Deferred to a follow-up; the registration split (Problem 1) unblocks this without requiring it now.

### Problem 3 — Schema transport across workers (deferred)

Zod schema objects are not structured-cloneable. Passing a `ServiceDeclaration` via `postMessage` loses the schema's validation methods. The module-specifier approach sidesteps this: the host worker imports declaration modules directly, obtaining live Zod instances. Deferred with the worker spawner.

### Problem 4 — Host doesn't get a ServiceClient (deferred)

The spec says the `ServiceClient` is available within service hosts, enabling service-to-service calls. The current `ServiceHost` does not provide one. `ServiceCallContext` would need to carry a `ServiceClient`. Deferred until a service needs to call another service.

### Problem 5 — Broker-as-worker has no entry point (deferred)

There is no worker script that constructs a `ServiceBroker` in a worker. Deferred with the worker spawner.

### Scope of current change

Only Problem 1 is addressed now: separating declaration registration from implementation resolution, introducing a `ServiceModuleRegistry` mapping service IDs to module specifiers, and updating the `HostSpawner` interface so the broker no longer holds implementations. This is a design-level fix that affects the public API and unblocks the worker topology without building it.

### Registration record: serializable only

The initial `ServiceModule` design bundled a live `ServiceDeclaration` with the module specifier. This works in-process (shared memory) but is non-serializable: `ServiceDeclaration` carries live Zod schema objects, which lose their methods across `postMessage`. Since the spec requires the broker to run in a Web Worker and receive registrations from the main thread, the registration record must be structured-cloneable.

**Decision:** `ServiceRegistration` contains only `{ id, moduleSpecifier, metadata }` — all serializable. The broker holds these records, not live declarations. It delegates parameter and return validation to the host (per the spec's "broker or host" wording), which imports the module to obtain live Zod schemas. The module specifier is the serializable handle that crosses worker boundaries in place of the non-serializable declaration.

This also resolves the schema transport problem (Problem 3): each worker that needs live schemas imports the module itself, rather than receiving schemas via `postMessage`.

### `HostLaunchRequest`: serializable

`HostLaunchRequest` carries `{ serviceId, moduleSpecifier }` — serializable. The broker sends these to the spawner, which resolves the live declaration and implementation. For `InProcessHostSpawner`, resolution is via a `ServiceModuleResolver` function; for a future `WorkerHostSpawner`, it would be via `import(moduleSpecifier)`.

### `InProcessHostSpawner`: resolver function

The in-process spawner takes a `ServiceModuleResolver` — a function mapping `(serviceId, moduleSpecifier)` to `{ declaration, implementation }`. This is necessary because dynamic import of module specifiers is not always available in test environments, and because in-process tests have the live objects already. A worker-based spawner would use `import()` instead.

## `ServiceBus` facade

A main-thread facade was added to provide a single entry point for bootstrapping the bus. The user suggested creating a singleton `ServiceBus` or attaching it to the global `window`.

### Design

`ServiceBus` owns the broker and exposes the client. It creates a transport pair (in-process by default), constructs the broker via a `BrokerFactory`, starts it, and creates the `ServiceClient`. It provides:

- `register(registration)` — forwarding serializable `ServiceRegistration` records to the broker;
- `createProxy(declaration)` — creating typed proxies from live `ServiceDeclaration` objects (the consumer imports the declaration module on the main thread to get live Zod schemas);
- `serviceClient` — direct access to the `ServiceClient`;
- `dispose()` — stopping the broker and disposing the client.

The `BrokerFactory` option allows the broker to run in a dedicated Web Worker in future, by providing a factory that creates a `Worker`, wraps it with `createWorkerTransport`, and constructs the `ServiceBroker` against that transport. The default factory runs the broker in-process, which is suitable for tests and for the current stage where a broker worker entry point does not yet exist (Problem 5, deferred).

### Singleton and `window` attachment

`getServiceBus(options)` creates and returns a singleton, ignoring options on subsequent calls. `peekServiceBus()` returns the existing singleton or `null`. `resetServiceBus()` disposes and clears it. When `window` is present (browser environment), the singleton is attached as `window.__darklingServiceBus` for convenient access. The attachment is done inside `getServiceBus`/`resetServiceBus`, not at module load time, so it reflects the current singleton state.

## `ServiceImplementation` as an abstract class

The user proposed making `ServiceImplementation` an abstract class that receives the `ServiceHost` (via a narrower context interface) as a constructor parameter. This replaces the earlier mapped-type approach where implementations were plain objects of async functions.

### Motivation

The abstract class model gives implementations access to the host at construction time. This directly addresses the deferred "service-to-service calls" gap (Problem 4): the host provides a `ServiceClient` via the `HostContext`, enabling implementations to create proxies and invoke other services on the bus. The mapped-type approach had no mechanism for injecting host access into implementations.

### Design decisions

- **`HostContext` interface, not `ServiceHost` directly.** The constructor receives a narrower `HostContext` interface exposing what implementations need (currently `serviceClient`), rather than the full `ServiceHost`. This avoids over-coupling implementations to the host's internal transport and dispatch machinery.
- **New `service-implementation.ts` module.** `ServiceImplementation` was moved out of `service-host.ts` into its own module to break the circular dependency between `declaration.ts` (which references the implementation type for the loader's return type) and `service-host.ts` (which references `ServiceDeclaration`). `ServiceCallContext` was also extracted into its own `service-call-context.ts` module.
- **Loader returns a constructor (class), not an instance.** The `implementationLoader` now returns `Promise<new (hostContext) => ServiceImplementation>` — a constructor function. The host instantiates the class with the `HostContext`, so it can inject the bus access at construction time. This is why the loader returns a class rather than an instance.
- **`invoke` method for dispatch.** The abstract class declares an `invoke(functionName, params, context)` method that the host calls. Subclasses implement their functions as logic inside `invoke`, dispatching by function name. The default implementation does not prescribe how subclasses organise their methods; `invoke` is the dispatch contract.

### What changed

- `ServiceImplementation` is now an abstract class in `service-implementation.ts`, not a mapped type in `service-host.ts`.
- `ServiceHost` constructor takes a `HostContext` and passes it to each implementation's constructor via `activate(declaration, implementationClass)`.
- `InProcessHostSpawner` takes a `HostContext` alongside the resolver, and passes it to the `ServiceHost`.
- `ServiceCallContext` (per-call context) moved to `service-call-context.ts`; `HostContext` (construction-time context) is in `service-implementation.ts`.
- The `ServiceDeclaration.implementationLoader` return type changed from `Promise<ServiceImplementation>` (instance) to `Promise<new (hostContext) => ServiceImplementation>` (constructor).

## Worker entry points

The worker topology required by the spec (broker and each host in dedicated Web Workers) is now implemented with two worker entry points and supporting infrastructure.

### Broker worker (`broker-worker.ts`)

Runs the `ServiceBroker` inside a Web Worker. The main thread creates the worker and sends a `BrokerWorkerInit` message with service registrations and the host worker URL. The worker creates a `ServiceModuleRegistry`, `WorkerHostSpawner`, and `ServiceBroker`, then starts. Subsequent `BrokerWorkerRegister` messages add services after init. This resolves Problem 5 (broker-as-worker has no entry point) from the bootstrap analysis.

### Host worker (`host-worker.ts`)

Runs a `ServiceHost` inside a Web Worker, spawned by `WorkerHostSpawner`. The broker sends `HostWorkerInit` with service IDs + module specifiers. The worker dynamically `import()`s each declaration module, calls `implementationLoader()` to get the implementation class, creates a `ServiceHost` with a `HostContext` containing a `ServiceClient` wired back to the broker, activates the services, and sends `HostWorkerReady`.

The `ServiceClient` in the `HostContext` resolves Problem 4 (host doesn't get a `ServiceClient`): implementations can now create proxies and invoke other services on the bus from within the host worker.

### `WorkerHostSpawner`

A `HostSpawner` that creates a `new Worker(hostWorkerUrl)`, sends `HostWorkerInit`, waits for `HostWorkerReady`/`HostWorkerError`, and returns a `LaunchedHost` with a `createWorkerTransport(worker)` transport. The ready/error handshake ensures the broker doesn't route calls to a host before it has finished activating services.

### `createWorkerBrokerFactory`

A `BrokerFactory` for the `ServiceBus` facade that runs the broker in a worker. It creates the broker worker, sends `BrokerWorkerInit`, and returns a `BrokerFactoryResult` with the worker transport as the `clientTransport` and a broker proxy.

#### `BrokerFactory` signature change: factory owns transport creation

The initial `BrokerFactory` signature was `(brokerTransport, spawner) => ServiceBroker` — the facade created an in-process transport pair and passed one end to the factory. This worked for the in-process case but was wrong for the worker case: the factory needed its own transport (`createWorkerTransport(worker)`), so the facade's transport was unused. The initial worker factory bridged envelopes between the two transports — an unnecessary extra hop with three transports (`facadeTransport`, `workerTransport`, `brokerTransport`) where only one was needed.

The fix: `BrokerFactory` is now `(spawner) => BrokerFactoryResult` where `BrokerFactoryResult` includes `clientTransport`. The factory creates the transport and returns it; the facade uses it for the `ServiceClient`. For the in-process case, the factory creates a transport pair and returns one end. For the worker case, the factory creates a `Worker` and returns `createWorkerTransport(worker)` — the `ServiceClient` talks directly to the broker worker through a single transport, with no bridging.

### Dynamic import and bundling

The host worker uses `import(/* @vite-ignore */ moduleSpecifier)` to load declaration modules at runtime. The `@vite-ignore` comment tells Vite not to statically analyse the import. In dev mode, the specifier resolves via the dev server; in production, the declaration modules must be individually addressable at runtime (as separate chunks or external URLs). Statically bundling all declarations into a registry (via `import.meta.glob` or a hand-written registry module) is a future optimisation that avoids the runtime `import()` requirement.

### Control message protocol (`worker-protocol.ts`)

The bootstrap protocol uses typed control messages (`BrokerWorkerInit`, `BrokerWorkerRegister`, `HostWorkerInit`, `HostWorkerReady`, `HostWorkerError`) with type guards, distinct from the `Envelope` messages that carry service calls and returns. This keeps the bootstrap lifecycle separate from the service bus's normal message routing.

### Worker entry points not exported from index

The worker entry points (`broker-worker.ts`, `host-worker.ts`) are not exported from the package index — they are worker scripts consumed by bundlers as worker entry points via `new Worker(new URL(..., import.meta.url))`, not library API. The supporting types and classes (`WorkerHostSpawner`, `createWorkerBrokerFactory`, control message types) are exported from the index.

### In-process is a testing convenience, not the production path

The in-process transport (`createInProcessTransportPair`) and spawner (`InProcessHostSpawner`) exist for testing and standalone use. The typical production deployment is worker-based: the `ServiceBus` facade uses `createWorkerBrokerFactory` to run the broker in a dedicated worker, the broker uses `WorkerHostSpawner` to launch host workers, and the `ServiceClient` communicates with the broker via `createWorkerTransport(worker)`.

The facade's default `BrokerFactory` is in-process so that tests and non-browser environments work without a bundler or worker URLs. A consumer wires up the worker path by providing `brokerFactory: createWorkerBrokerFactory({ brokerWorkerUrl, hostWorkerUrl, registrations })`, where the URLs are obtained from the bundler (e.g. `new URL('./broker-worker.ts', import.meta.url)` in Vite). The package cannot default to the worker path because the worker entry point URLs are consumer-specific and not known inside the package.

The modular `Transport` interface keeps both paths clean: the in-process transport carries no worker baggage, and the worker transport carries no worker in-process baggage. The transports may prove useful for future alternative channels (e.g. `MessagePort`-based, `ServiceWorker`-based).

## Lit integration

An optional Lit integration is provided via the `@darkling/service-bus/lit` subpath, with `lit` and `@lit/context` as optional peer dependencies.

### `<service-bus-host>` custom element

A Lit custom element that hosts the `ServiceBus` facade and provides the `ServiceClient` to descendants via Lit's context mechanism. The element creates and owns a `ServiceBus` when it connects to the DOM, disposes it when disconnected, and recreates it if the options change. The `ServiceClient` is provided via a `ContextProvider` from `@lit/context`.

The element is defined imperatively (`customElements.define` without `@customElement` decorator) so it works with both standard TC39 decorators and experimental decorators. The frontend's tsconfig uses `experimentalDecorators: true` (the Lit-recommended setup), but the package's base tsconfig does not; using imperative registration avoids coupling the package to a specific decorator mode.

### `consumeServiceClient()` decorator and `useServiceClient` hook

Consumer elements retrieve the `ServiceClient` via either a `@consumeServiceClient()` property decorator (wrapping `@lit/context`'s `consume`) or an imperative `useServiceClient(host, callback)` hook (using `ContextConsumer`). The `ContextConsumer` is a `ReactiveController` cleaned up automatically on disconnect, so the hook has no manual unsubscribe.

### Optional peer dependencies

`lit` and `@lit/context` are declared as optional peer dependencies in `package.json`. The core package (`.` entry point) has no Lit dependency; only the `./lit` subpath imports from Lit. This keeps the core package usable in non-Lit environments (Node.js, other frameworks).

## `HostSpawner` removed from `ServiceBusOptions`

The `ServiceBus` facade previously required a `HostSpawner` in its options and passed it to the `BrokerFactory`, which passed it to the `ServiceBroker`. But the spawner is a _broker_ concern — the broker decides how to launch hosts. In the worker topology, the broker worker creates its own `WorkerHostSpawner` from the `hostWorkerUrl`; the spawner passed by the facade was ignored by `createWorkerBrokerFactory`. The facade was leaking a broker implementation detail.

The fix: `HostSpawner` is removed from `ServiceBusOptions` and `BrokerFactory`. The factory creates the spawner internally:

- `createInProcessBrokerFactory(resolver, hostContext)` — creates an `InProcessHostSpawner` and `ServiceBroker` in-process. Used for tests.
- `createWorkerBrokerFactory({ brokerWorkerUrl, hostWorkerUrl, registrations })` — the broker worker creates its own `WorkerHostSpawner` from the `hostWorkerUrl`. Used for production.
- The default factory (when no `brokerFactory` is provided) creates a broker with a throwing spawner, since without a resolver or worker URLs there is no way to launch hosts. Consumers must provide a factory.

The `ServiceBusHostOptions` in the Lit integration was updated accordingly: `spawner` was removed, `brokerFactory` is now optional.

## `<service-bus-host>` defaults to worker-based broker

The `ServiceBusHostOptions` was changed so that `brokerFactory` is optional, and the element defaults to a worker-based broker when `brokerWorkerUrl` and `hostWorkerUrl` are provided. The element constructs the `BrokerFactory` internally via `createWorkerBrokerFactory` from the URLs. This makes the worker path the default for browser use, which is the typical production deployment.

For in-process testing, the consumer provides `brokerFactory` directly (e.g. via `createInProcessBrokerFactory`), which takes precedence over the URL options. When `brokerFactory` is provided, the element registers services via `bus.register()`; when the worker factory is used, registrations are sent in the `BrokerWorkerInit` message (the worker factory handles this).

## Logging (observability)

Wired diagnostic logging into the broker, host, and client via the new
`@darkling/observability` package (consola-backed). This is an implementation
concern: no spec governs logging, and the wiring is additive — it emits
diagnostic output only, with no control-flow or behavioural change.

- `ServiceBroker` logs: broker start/stop, call routing (service/function/
  messageId/hostId), host launch, calls to unregistered services, and host
  unavailability.
- `ServiceHost` logs: service activation, host start, parameter-validation
  failures, call success/failure, and per-call dispatch errors.
- `ServiceClient` logs: call returns, call rejections, and call timeouts.

All logs are out-of-band (operator/developer only); per-worker console sink via
consola's default reporter. The logger tags are the closed set
`service-bus:broker`/`service-bus:host`/`service-bus:client` in
`@darkling/observability`'s `LOG_TAGS`. See
`packages/observability/package.journal.md` for the cross-cutting decision and
the deferred spec-authority question.

## `ServiceBusHost.options` is now a reactive property

The `ServiceBusHost.options` field was previously a plain (non-reactive) field documented as "set this before the element connects to the DOM." When the frontend moved the `<service-bus-host>` out of `<darkling-app>`'s render and into `index.html` (so it could be an ancestor provider for Lit context), `main.ts` set `options` imperatively *after* the element connected — but a plain field set post-connect never triggers `updated()`, so `_startBus()` ran once in `connectedCallback` with `options === undefined` (returning early) and the broker never started.

Fix: `options` is now a reactive Lit property, declared imperatively via `static properties = { options: { type: Object } }` (no decorator, preserving the element's "works with both standard and experimental decorator configurations" convention). Setting it after connection triggers `updated()` → `_restartBus()`, so the bus starts once configured. The `updated()` restart-on-change handler (already present) now actually fires. The same change was applied to `StateManagerHost.options`.

**Follow-up (class-field shadowing):** the first attempt kept `options?: ServiceBusHostOptions;` as a class field alongside `static properties`, which threw Lit's class-field-shadowing error ("will not trigger updates as expected because they are set using class fields"). A class field initializer overwrites Lit's change-detecting accessor. The field is therefore declared with `declare options: ServiceBusHostOptions | undefined;` (type-only, no emitted field), so Lit's accessor is used and updates fire. The same `declare` form applies to `StateManagerHost.options`.

Recorded because it changes the documented usage contract ("set before connect" → "set before or after connect").
