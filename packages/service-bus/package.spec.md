# `@darkling/service-bus` package

## Purpose and scope

This specification defines the `@darkling/service-bus` package: the implementation package that provides the service bus as a consumable library.

It governs:

- the package's public API surface — the types, classes, and functions exported from the package entry point;
- the package's structural contract — the modules, their responsibilities, and their relationships;
- the package's dependencies and build configuration;
- the conformance of the package to [Service bus](../../specs/service-bus.spec.md), which remains the normative specification for the service bus subsystem.

It is explicitly out of scope for this specification to define:

- the normative requirements of the service bus subsystem — which are defined by [Service bus](../../specs/service-bus.spec.md);
- the specific services that run on the bus — which are defined by their respective domain specifications;
- the behaviour of the constrained agent, event system, content model, or retrieval — which are defined by their respective specifications.

Where this specification depends on behaviour defined by [Service bus](../../specs/service-bus.spec.md), it links to it and states its requirement in terms of the package's conformance to that specification. This specification is an implementation contract: it governs how the package is structured and consumed, not the behavioural requirements of the service bus itself.

## Relationship to `specs/service-bus.spec.md`

[Service bus](../../specs/service-bus.spec.md) defines the normative requirements for the service bus subsystem: the `ServiceBroker`, `ServiceHost`, and `ServiceClient` architecture; service registration and on-demand activation; the service interface contract; the message envelope; Transferable object handling; and promise resolution.

This specification defines the package that implements those requirements. The package conforms to [Service bus](../../specs/service-bus.spec.md); this specification does not restate or refine those normative requirements. Where the package makes an implementation decision that [Service bus](../../specs/service-bus.spec.md) leaves open, that decision is recorded in [package.journal.md](./package.journal.md) and, where it has an observable effect on the package's public API, noted in this specification.

## Registration and bootstrap model

[Service bus](../../specs/service-bus.spec.md) requires the broker and each host to run in separate Web Workers, with the `ServiceClient` on the caller's thread. The package's registration model is designed to support this topology:

- **Registrations are serializable.** A `ServiceRegistration` record (service ID + module specifier + metadata) contains only structured-cloneable fields. The main thread can register services with the broker worker via `postMessage` without loss.
- **Live declarations are not held by the broker.** A `ServiceDeclaration` carries live Zod schema objects, which are not structured-cloneable (they lose their methods across `postMessage`). The broker holds only serializable registration records; it delegates validation to the host, as permitted by the spec's "broker or host" wording.
- **Hosts obtain live objects by importing the module.** The module specifier points to a module exporting the `ServiceDeclaration` (with live Zod schemas) and `ServiceImplementation`. Each host worker imports the module to obtain fresh, live instances. The module specifier is the serializable handle that crosses worker boundaries in place of the non-serializable objects.

This model unblocks the worker topology without requiring a worker-based spawner to exist yet; the in-process spawner uses a resolver function in place of dynamic import.

## Public API surface

The package exports its public API from a single entry point (`./src/index.ts`, mapped as `.` in `package.json` `exports`). The public API consists of the types, classes, and functions defined below. Internal modules are not exported; consumers depend only on the public API.

### Envelope types

The package exports the message envelope types defined by [Message envelope](../../specs/service-bus.spec.md#message-envelope):

- `Envelope` — a SOAPjr-style message envelope with a head and body;
- `EnvelopeHead` — the routing metadata (message ID, service identifier, function name, message type, transferables);
- `MessageType` — the union `'call' | 'return' | 'error'`;
- `MessageId`, `ServiceId`, `FunctionName`, `TransferableRef` — string-branded type aliases for envelope head fields.

### Declaration types

The package exports the service declaration types defined by [Service registration](../../specs/service-bus.spec.md#service-registration) and [Service interface contract](../../specs/service-bus.spec.md#service-interface-contract):

- `ServiceDeclaration` — a service's interface and metadata, separate from its implementation, including an `implementationLoader` that asynchronously returns the implementation class (a constructor);
- `ServiceFunctionDeclaration` — a function's parameter and return Zod schemas, with optional cost and description;
- `ServiceMetadata` — service-level metadata for broker routing and activation;
- `ServiceInterface<T>` — a mapped type deriving typed methods from a `ServiceDeclaration`'s Zod schemas, used for proxy typing.

### Transport

The package exports a `Transport` interface and a `TransportPair` type, as defined by [Worker topology](../../specs/service-bus.spec.md#worker-topology), abstracting the message-passing channel between the broker, hosts, and clients. The package provides two transport implementations:

- `createInProcessTransportPair()` — creates a pair of connected in-process `Transport` endpoints, used for testing and the in-process host spawner. The in-process transport is a testing convenience; the typical production deployment uses worker-based transports (`createWorkerTransport`);
- `createWorkerTransport(worker, options)` — creates a `Transport` backed by a Web `Worker` or `MessagePort`, handling Transferable objects as defined by [Transferable objects](../../specs/service-bus.spec.md#transferable-objects).

The `Transport` interface is an implementation abstraction not named by [Service bus](../../specs/service-bus.spec.md); it is part of this package's implementation contract. A consumer may provide custom `Transport` implementations to integrate the bus with alternative message-passing channels.

### Errors

The package exports a structured error hierarchy rooted at `ServiceBusError`, with subclasses for each error condition defined by [Service bus](../../specs/service-bus.spec.md):

- `ValidationError` — parameter validation failure, as defined by [Validation](../../specs/service-bus.spec.md#validation);
- `ReturnValidationError` — return value validation failure;
- `HostUnavailableError` — host unavailable or failure to respond, as defined by [Promise resolution](../../specs/service-bus.spec.md#promise-resolution);
- `ServiceNotRegisteredError` — the service is not registered with the broker;
- `FunctionNotDeclaredError` — the function is not declared on the service.

All errors serialise to plain objects for transport across worker boundaries and deserialise via `ServiceBusError.fromJSON` / `deserialiseError`. The `isServiceBusErrorSerialised` type guard and `ServiceBusErrorSerialised` interface support this.

[Service bus](../../specs/service-bus.spec.md) does not define an error taxonomy; this package's hierarchy is an implementation decision recorded in [package.journal.md](./package.journal.md).

### `ServiceClient`

The package exports the `ServiceClient` class, the caller-side component defined by [Service bus](../../specs/service-bus.spec.md#serviceclient). It:

- creates typed, validating proxies on demand from `ServiceDeclaration` instances via `createProxy<T>(declaration)`;
- issues calls to the broker, correlates return and error messages by message ID, and resolves or rejects the caller's promise, as defined by [Promise resolution](../../specs/service-bus.spec.md#promise-resolution);
- rejects with `HostUnavailableError` on host failure, as defined by [Promise resolution](../../specs/service-bus.spec.md#promise-resolution);
- accepts a `ServiceClientOptions` with a configurable `callTimeoutMs`, which is the package's mechanism for detecting host failure.

### `ServiceHost`

The package exports the `ServiceHost` class, the host-side component defined by [Service bus](../../specs/service-bus.spec.md#servicehost). It:

- receives messages from the broker, dispatches them to service functions, and returns results;
- may support multiple services, activated via `activate(declaration, implementationClass)` — the host instantiates the implementation class with a `HostContext`, injecting bus access;
- validates parameters against Zod schemas before dispatch and return values before sending, as defined by [Validation](../../specs/service-bus.spec.md#validation).

The `ServiceHost` constructor takes a `Transport` and a `HostContext`. The `HostContext` is passed to each service implementation's constructor, giving it access to the bus (e.g. a `ServiceClient` for service-to-service calls).

### `ServiceImplementation`

The package exports an abstract `ServiceImplementation` class and a `HostContext` interface. A service implementation is a class extending `ServiceImplementation`, providing an `invoke(functionName, params, context)` method that the host calls to dispatch function calls. The implementation receives a `HostContext` in its constructor, giving it access to the bus at construction time.

The package also exports `ServiceCallContext` (the per-call context: service ID, function name, message ID), distinct from `HostContext` (the construction-time context).

### `ServiceBroker`

The package exports the `ServiceBroker` class, the central routing and coordination point defined by [Service bus](../../specs/service-bus.spec.md#servicebroker). It:

- routes messages between service clients and service hosts;
- maintains the service registry — serializable registration records (ID, module specifier, metadata) only; it does not hold live declarations or implementations;
- delegates parameter and return validation to the host, which imports the service module to obtain live Zod schemas;
- decides when to launch a new host and when to activate a service, as defined by [On-demand activation](../../specs/service-bus.spec.md#on-demand-activation);
- routes return and error messages back to the `ServiceClient`.

The broker is constructed with a client `Transport`, a `HostSpawner`, and optionally a `ServiceModuleRegistry`. Services are registered via `register(registration)` with a `ServiceRegistration` record (ID + module specifier + metadata).

### `ServiceModuleRegistry`

The package exports the `ServiceModuleRegistry` class and `ServiceRegistration` / `ModuleSpecifier` types. The registry holds serializable registration records: service IDs mapped to module specifiers and metadata. The broker uses it for routing and activation decisions; it does not hold live `ServiceDeclaration` objects (with Zod schemas) or implementations, since those are not structured-cloneable and must be obtained by importing the module in the host worker.

### `HostSpawner`

The package exports the `HostSpawner` interface, `HostLaunchRequest` type, and `LaunchedHost` type, as the abstraction by which the broker launches hosts on demand. The spawner receives serializable `HostLaunchRequest`s (service ID + module specifier) and resolves the live declarations and implementations itself. The package provides one implementation:

- `InProcessHostSpawner` — launches hosts in-process using `createInProcessTransportPair`, resolving implementations via a `ServiceModuleResolver` function. Used for testing; the typical production deployment uses `WorkerHostSpawner`.

The package also exports the `ServiceModuleResolver` type for the resolver function used by `InProcessHostSpawner`.

A `HostSpawner` is an implementation abstraction not named by [Service bus](../../specs/service-bus.spec.md); it is part of this package's implementation contract. A consumer may provide a custom `HostSpawner` to integrate the bus with real Web Workers or other execution environments.

### `ServiceBus` facade

The package exports a `ServiceBus` class — a main-thread facade that creates and owns the `ServiceBroker`, exposes the `ServiceClient`, and provides a single entry point for service registration and proxy creation. It:

- creates a transport and constructs the broker via a `BrokerFactory` (in-process by default for testing; a worker-based factory via `createWorkerBrokerFactory` is the intended production deployment). The factory owns the host spawner — the facade does not deal with spawners, which are a broker implementation detail. The package provides `createInProcessBrokerFactory(resolver, hostContext)` for tests;
- starts the broker and creates the `ServiceClient`;
- exposes `register(registration)` forwarding serializable `ServiceRegistration` records to the broker;
- exposes `createProxy(declaration)` creating typed proxies from live `ServiceDeclaration` objects (which the consumer imports on the main thread);
- exposes `serviceClient` for direct access;
- provides `dispose()` to stop the broker and dispose the client.

The package also exports singleton accessors: `getServiceBus(options)` (creates and returns the singleton, attaching it to `window.__darklingServiceBus` when `window` is present), `peekServiceBus()` (returns the existing singleton or `null`), and `resetServiceBus()` (disposes and clears the singleton).

The `ServiceBus` facade is an implementation abstraction not named by [Service bus](../../specs/service-bus.spec.md); it is part of this package's implementation contract.

### Worker entry points

The package provides two worker entry points and supporting infrastructure for the spec's Web Worker topology, where the broker and each host run in dedicated workers.

**`broker-worker.ts`** — the broker worker entry point. The main thread creates a `Worker` from this URL and sends a `BrokerWorkerInit` message (service registrations + host worker URL). The worker creates a `ServiceModuleRegistry`, a `WorkerHostSpawner`, and a `ServiceBroker` wired to `createWorkerTransport(self)`, then starts. Subsequent `BrokerWorkerRegister` messages add services after init.

**`host-worker.ts`** — the host worker entry point, spawned by `WorkerHostSpawner`. The broker sends a `HostWorkerInit` message (service IDs + module specifiers). The worker dynamically `import()`s each declaration module, calls `implementationLoader()` to get the implementation class, creates a `ServiceHost` with a `HostContext` containing a `ServiceClient` wired back to the broker, activates the services, and sends `HostWorkerReady`. The `ServiceClient` in the `HostContext` enables service-to-service calls from within the host worker.

**`WorkerHostSpawner`** — a `HostSpawner` that creates a `new Worker(hostWorkerUrl)`, sends `HostWorkerInit`, waits for `HostWorkerReady`/`HostWorkerError`, and returns a `LaunchedHost` with a `createWorkerTransport(worker)` transport.

**`createWorkerBrokerFactory`** — a `BrokerFactory` that creates a broker worker, sends `BrokerWorkerInit`, and returns a broker proxy that forwards registrations and bridges the transport between the `ServiceClient` (main thread) and the broker worker.

**`worker-protocol.ts`** — the control message types (`BrokerWorkerInit`, `BrokerWorkerRegister`, `HostWorkerInit`, `HostWorkerReady`, `HostWorkerError`) and type guards exchanged between the main thread, broker worker, and host workers during bootstrap.

The worker entry points are not exported from the package index (they are worker scripts, not library API). They are consumed by bundlers as worker entry points via `new Worker(new URL('./broker-worker.ts', import.meta.url))`. The supporting types (`WorkerHostSpawner`, `WorkerBrokerFactoryOptions`, control message types) are exported from the index.

## Module structure

The package is organised into modules, each with a single responsibility. Internal modules are not part of the public API but are documented here for maintainability.

| Module                       | Responsibility                                                                                            | Spec reference                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envelope.ts`                | Envelope types: `Envelope`, `EnvelopeHead`, `MessageType`, and related aliases.                           | [Message envelope](../../specs/service-bus.spec.md#message-envelope)                                                                                                   |
| `declaration.ts`             | Service and function declaration types, `ServiceInterface` mapped type.                                   | [Service registration](../../specs/service-bus.spec.md#service-registration), [Service interface contract](../../specs/service-bus.spec.md#service-interface-contract) |
| `errors.ts`                  | `ServiceBusError` hierarchy, serialisation, deserialisation.                                              | [Promise resolution](../../specs/service-bus.spec.md#promise-resolution)                                                                                               |
| `transport.ts`               | `Transport` interface.                                                                                    | [Worker topology](../../specs/service-bus.spec.md#worker-topology)                                                                                                     |
| `in-process-transport.ts`    | `createInProcessTransportPair` implementation.                                                            | —                                                                                                                                                                      |
| `worker-transport.ts`        | `createWorkerTransport` implementation, Transferable handling.                                            | [Transferable objects](../../specs/service-bus.spec.md#transferable-objects)                                                                                           |
| `service-client.ts`          | `ServiceClient` class, typed proxy creation, promise resolution.                                          | [ServiceClient](../../specs/service-bus.spec.md#serviceclient), [Typed proxies](../../specs/service-bus.spec.md#typed-proxies)                                         |
| `service-host.ts`            | `ServiceHost` class, service activation, call dispatch, validation.                                       | [ServiceHost](../../specs/service-bus.spec.md#servicehost)                                                                                                             |
| `service-implementation.ts`  | `ServiceImplementation` abstract class, `HostContext` interface.                                          | [Service interface contract](../../specs/service-bus.spec.md#service-interface-contract)                                                                               |
| `service-call-context.ts`    | `ServiceCallContext` — per-call context (service ID, function name, message ID).                          | [Service interface contract](../../specs/service-bus.spec.md#service-interface-contract)                                                                               |
| `host-spawner.ts`            | `HostSpawner` interface, `LaunchedHost` type.                                                             | [On-demand activation](../../specs/service-bus.spec.md#on-demand-activation)                                                                                           |
| `service-broker.ts`          | `ServiceBroker` class, `InProcessHostSpawner`, `ServiceModuleResolver`, routing, host lifecycle.          | [ServiceBroker](../../specs/service-bus.spec.md#servicebroker)                                                                                                         |
| `service-module-registry.ts` | `ServiceModuleRegistry`, `ServiceRegistration`, `ModuleSpecifier` — serializable registration records.    | [Service registration](../../specs/service-bus.spec.md#service-registration)                                                                                           |
| `service-bus.ts`             | `ServiceBus` facade, singleton accessors, `BrokerFactory`.                                                | [ServiceBroker](../../specs/service-bus.spec.md#servicebroker), [ServiceClient](../../specs/service-bus.spec.md#serviceclient)                                         |
| `worker-protocol.ts`         | Control message types and type guards for broker/host worker bootstrap.                                   | [Worker topology](../../specs/service-bus.spec.md#worker-topology)                                                                                                     |
| `broker-worker.ts`           | Broker worker entry point — runs `ServiceBroker` in a dedicated Web Worker.                               | [ServiceBroker](../../specs/service-bus.spec.md#servicebroker)                                                                                                         |
| `host-worker.ts`             | Host worker entry point — runs `ServiceHost` in a dedicated Web Worker, dynamically imports declarations. | [ServiceHost](../../specs/service-bus.spec.md#servicehost)                                                                                                             |
| `worker-host-spawner.ts`     | `WorkerHostSpawner` — launches host workers on demand.                                                    | [On-demand activation](../../specs/service-bus.spec.md#on-demand-activation)                                                                                           |
| `worker-broker-factory.ts`   | `createWorkerBrokerFactory` — `BrokerFactory` that runs the broker in a worker.                           | [ServiceBroker](../../specs/service-bus.spec.md#servicebroker)                                                                                                         |
| `index.ts`                   | Public API barrel export.                                                                                 | —                                                                                                                                                                      |

### Lit integration (`./lit` subpath)

The package provides an optional Lit integration via the `@darkling/service-bus/lit` subpath. Lit and `@lit/context` are optional peer dependencies; importing this subpath requires both to be installed.

The subpath exports:

- **`ServiceBusHost`** — a `<service-bus-host>` custom element that creates and owns a `ServiceBus` instance when it connects to the DOM, and disposes it when disconnected. The `ServiceBus` options are set via the `options` property. The element defaults to a worker-based broker, constructing the `BrokerFactory` from the provided `brokerWorkerUrl` and `hostWorkerUrl` via `createWorkerBrokerFactory`. For in-process testing, a `brokerFactory` can be provided directly, which takes precedence over the URL options. The element provides the `ServiceClient` to descendants via Lit's context mechanism using a `ContextProvider`. The element is defined imperatively (no TypeScript decorators) so it works with both standard and experimental decorator configurations.
- **`ServiceBusHostOptions`** — the options interface for the host element: `brokerWorkerUrl` and `hostWorkerUrl` (for the default worker-based path), `brokerFactory` (optional, takes precedence), and `registrations` (optional).
- **`serviceClientContext`** — the Lit `Context` key for the `ServiceClient`.
- **`consumeServiceClient()`** — a property decorator that consumes the `ServiceClient` from the nearest ancestor `<service-bus-host>`. Requires decorator support in the consumer's TypeScript configuration.
- **`useServiceClient(host, callback)`** — an imperative hook for accessing the `ServiceClient` without decorators. The `ContextConsumer` is a `ReactiveController` cleaned up automatically on disconnect.

| Module                          | Responsibility                                                             | Spec reference |
| ------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `lit/service-client-context.ts` | `serviceClientContext` — the Lit `Context` key for the `ServiceClient`.    | —              |
| `lit/consume-service-client.ts` | `consumeServiceClient` decorator, `useServiceClient` hook.                 | —              |
| `lit/service-bus-host.ts`       | `ServiceBusHost` custom element (`<service-bus-host>`), `ContextProvider`. | —              |
| `lit/index.ts`                  | Lit subpath barrel export.                                                 | —              |

## Dependencies

The package depends on:

- `zod` (v4) — for parameter and return type schemas, as required by [Service bus](../../specs/service-bus.spec.md#service-interface-contract);
- `@repo/eslint-config` (dev) — for linting.

The package must not depend on any other workspace package or runtime dependency unless this specification is extended to permit it.

## Build and tooling

The package is an ESM package (`"type": "module"`). It is not built to a distribution directory; the `exports` field maps `.` directly to `./src/index.ts`, so the package is consumed as TypeScript source by other workspace packages. This is appropriate while the package is private and consumed only within the monorepo.

The package must provide `lint`, `check-types`, and `format` scripts consistent with the workspace conventions defined in [AGENTS.md](../../AGENTS.md).

## Conformance

The package conforms to this specification when:

- it exports the public API surface defined in [Public API surface](#public-api-surface) from a single entry point;
- the `ServiceClient`, `ServiceHost`, and `ServiceBroker` classes satisfy the behavioural requirements of [Service bus](../../specs/service-bus.spec.md), as verified by the package's tests;
- the `Transport` interface and its provided implementations satisfy the message-passing and Transferable-handling requirements of [Service bus](../../specs/service-bus.spec.md);
- the error hierarchy covers the error conditions defined by [Service bus](../../specs/service-bus.spec.md) and supports serialisation across worker boundaries;
- the `ServiceBus` facade creates and owns the broker, exposes the `ServiceClient`, and provides registration and proxy creation;
- the module structure matches [Module structure](#module-structure);
- the package's dependencies match [Dependencies](#dependencies);
- the package's build and tooling match [Build and tooling](#build-and-tooling).
