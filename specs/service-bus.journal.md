# Journal: Service bus

This journal records the development of [service-bus.spec.md](./service-bus.spec.md). It is non-normative; the specification takes precedence.

## Declaration module and implementation loading (spec clarification)

Established via the specification workflow, prompted by the first service package (`@darkling/knowledge-base`) initially placing its service declaration and implementation in a single module with an `implementationLoader` that returned `Promise.resolve(Implementation)` — eagerly pulling the implementation into any consumer of the declaration. The user identified this as defeating the lazy-loading purpose of the `implementationLoader` and requested the split, with the declaration as its own entry point and the loader wrapping a dynamic `import()`.

### Context

The root spec already established that the declaration and implementation are separate ("The service implementation is not part of the declaration... the host loads and executes the implementation"), and the `ServiceDeclaration` type includes an `implementationLoader`. The `@darkling/service-bus` package's [package.spec.md](../packages/service-bus/package.spec.md) documents the host worker's convention of dynamically `import()`ing a declaration module and calling `implementationLoader()`. However, neither normatively established the module/entry-point convention on the _service package_ side: that the declaration and implementation are separate modules, that the declaration module exports a named `declaration` export, that the `implementationLoader` wraps a dynamic `import()`, or that the declaration module must not import the implementation at module-load time.

### Decisions

Through dialogue with the user, the following were established as normative requirements in a new "Declaration module and implementation loading" subsection under [Service registration](./service-bus.spec.md#service-registration):

- **Separate modules.** The declaration and implementation are separate modules; the declaration module is the service's entry point.
- **Named `declaration` export.** The declaration module must export the `ServiceDeclaration` as a named `declaration` export — the convention the host worker relies on.
- **`implementationLoader` must use dynamic `import()`.** The loader must load the implementation module via dynamic `import()`, keeping the implementation out of the initial bundle. The user chose "must" over "should" so that lazy loading is normative, not optional. (Test-only in-process spawners that resolve implementations by reference are not affected: they do not use the `implementationLoader` path — the `InProcessHostSpawner` resolves implementations via a `ServiceModuleResolver` function, as documented in the service-bus package journal.)
- **Declaration must not import the implementation.** The declaration module must not import the implementation module at module-load time; it may import only types and schemas.

### Affected specifications reviewed

- [Service bus](./service-bus.spec.md) — the clarification extends "Service registration" with the module/entry-point convention. No contradiction with existing requirements.
- [Constrained agent](./constrained-agent.spec.md) — references services and tool categories but not the declaration/module mechanism. Unaffected.
- `@darkling/service-bus` [package.spec.md](../packages/service-bus/package.spec.md) — documents the host worker convention; the clarification makes the service-package side of that contract normative. Complementary, no contradiction.
- `@darkling/knowledge-base` [package.spec.md](../packages/knowledge-base/package.spec.md) — the package's service integration has been updated to conform (declaration and implementation split, `./service` subpath, `implementationLoader` wrapping `import()`).

## Origin

Created as the eighth specification. The README describes the service bus as "lightweight services run across Web Workers and are activated on demand." The user provided additional detail: the `ServiceBroker`/`ServiceHost` architecture, SOAPjr-style envelopes, Transferable object handling, and Zod 4 schemas. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Zod 4: mention, leave schemas to implementation.** The spec names Zod 4 as the schema technology for parameter and return types, but does not prescribe the specific schemas — those are defined by each service's definition. This is consistent with how FINISHED is handled in the constrained agent spec (named, but provider-agnostic in the details).
- **Service registration + activation: defined.** The spec defines how services register with the broker (service identifier, host assignment, schema declaration) and how hosts are activated on demand (transparent to the caller, reactivatable after deactivation).
- **Envelope structure: defined.** The spec defines the SOAPjr-style envelope normatively: head (message ID, service identifier, function name, message type) and body (payload), with routing by head and correlation by message ID.
- **Location.** `specs/service-bus.spec.md`.

## Key decisions and rationale

### Interface and metadata separate from implementation

The user specified that each service declares its interface and metadata separately from its implementation. The declaration (service identifier, schema declaration, metadata) is registered with the broker; the implementation runs on a host. This separation means the broker can route and validate without loading implementations, and implementations can be swapped without changing registrations. The registry maps service identifiers to declarations, not to specific host instances — the broker decides host assignment at dispatch time.

### Broker decides host launch and service activation

The user clarified that the broker decides when to launch a new host and when to activate a service and on which host. A host may support multiple services, so the broker may activate a service on an existing host rather than launching a new one. The decision is a broker policy informed by service metadata. This is more flexible than the initial draft, which implied one host per service. The location where a service runs is transparent to the consumer — the consumer invokes by service identifier and the broker routes.

### Transferables referenced in head, passed verbatim to postMessage

The user specified that Transferable objects in message bodies must be referenced in a field in the head, and this field is passed verbatim as the `transfer` parameter to `postMessage`. The spec now requires a `transferables` field in the head (a list of references to Transferable objects within the body), which the broker and hosts pass directly to `postMessage` without modification. This is more precise than the initial draft, which said Transferables "must be handled" without specifying the mechanism. The head now carries the transfer list explicitly, making the envelope self-describing about what needs transferring.

### ServiceClient: caller-side proxy creation and promise resolution

The user specified that the service client is available both on the main thread and to any service, creates typed proxies on demand, and handles promise resolution. This introduces a third component — the `ServiceClient` — alongside the broker and hosts. Key changes:

- **ServiceClient is the caller-side component.** It runs on the caller's thread (main thread or within a service host's worker), not in a dedicated worker. It is available wherever calls originate.
- **Proxy creation is on demand by the ServiceClient.** The typed proxies section was updated: a caller obtains a proxy from the `ServiceClient` by requesting one for a service identifier, and the `ServiceClient` constructs it from the declared interface. This replaces the earlier framing of "client code" generically.
- **Promise resolution moved from broker to ServiceClient.** The broker routes return/error messages back to the `ServiceClient`; the `ServiceClient` resolves or rejects the caller's promise. The "Promise fulfilment" section was renamed to "Promise resolution" and rewritten to reflect this. The broker's role is routing; the `ServiceClient`'s role is promise lifecycle.
- **Services can call other services.** Since the `ServiceClient` is available within service hosts, a service can obtain a proxy for another service and invoke it. This enables service-to-service communication through the same typed, validated interface.

### Typed proxies from declared interfaces

The user noted that because the service interface is declared separately from its implementation, the declaration is available to client code to expose typed and validating proxies. The spec now includes a Typed proxies section: client code can generate proxies with compile-time types derived from the Zod 4 schemas, and optionally validate parameters and returns at the call site. The proxy generation mechanism (code generation, runtime construction) is left to implementation. Proxies don't change the bus contract — they wrap the broker's promise-based invocation with typing and validation. This is a key benefit of the interface/implementation separation: consumers get type safety and IDE support without coupling to the service implementation.

### Broker and hosts in separate workers

The user specified that the broker and each host run in dedicated Web Workers. The spec makes this normative. This provides isolation (service execution doesn't block the main thread or other services) and concurrency (hosts execute in parallel, supporting the constrained agent spec's parallel tool call dispatch requirement).

### On-demand activation

The README states services are "activated on demand." The spec defines this as: a host is not running until a service it provides is invoked, activation is transparent to the caller (the promise is fulfilled regardless), and deactivated hosts can be reactivated. This keeps the worker footprint small when services are not in use.

### SOAPjr-style envelopes

The user specified SOAPjr-style envelopes with a head for routing and a body for payload. The spec defines the head's required fields (message ID, service identifier, function name, message type) and the body's content (parameter for calls, return value for returns, error for errors). The broker uses the head to route calls to hosts and to correlate returns to calls by message ID. This is a well-understood pattern that separates routing metadata from payload.

### Transferable object handling

The user specified that the broker and hosts handle Transferable objects. The spec makes this normative: Transferable objects in message bodies are transferred (not copied) between workers, with the sender's reference detached. The transfer is transparent to the service interface — the schemas describe the logical object, and the transfer mechanism is an envelope-handling implementation detail. This is important for performance when passing large buffers (e.g. vector embeddings for text search) between workers.

### Zod 4 schemas for validation

The user specified Zod 4 schemas for parameter and return types. The spec names Zod 4 and requires validation (parameters validated before dispatch, returns validated before sending back), but leaves the specific schemas to each service's definition. This ensures type safety at the bus boundary without coupling the bus spec to any particular service's types.

### Promise-based caller interface

Callers interact with the bus through promises, not raw message passing. The broker fulfils or rejects promises based on return/error messages from hosts, and rejects on host failure. This hides the envelope routing and worker communication behind a familiar async interface, which is how the constrained agent's tool calls consume the bus.

### Relationship to other specs

The spec explicitly maps the bus to the constrained agent (tool call dispatch, parallel execution), content-first retrieval (indexes as services), and event system (event production as services). This makes the bus's role as the execution substrate clear without defining the services themselves.

## Gaps and ambiguities

- **Host deactivation policy.** The spec states hosts may be deactivated when idle but does not define the idle threshold or deactivation behaviour. This is an implementation concern.
- **Service discovery.** The spec defines registration but not how callers discover available services or their schemas. This may need clarification — the constrained agent's tool definitions in the system prompt may serve as the discovery mechanism.
- **Error types.** The spec requires errors to be returned in error message bodies but does not define an error type taxonomy. Validation errors, host failures, and service-specific errors are all mentioned but not structured.
- **Message ordering.** The spec does not address message ordering guarantees between a caller and a host. Whether calls are processed in order or may be reordered is undefined.
- **Backpressure and queuing.** The spec does not address what happens when a host is overwhelmed with calls — whether calls queue, are rejected, or apply backpressure.
- **Security.** The spec does not address service isolation, authentication, or authorisation between services. Given that all services run in the same browser context, this may not be needed, but it is not stated.
- **Schema transport.** The spec requires schema declarations in registrations but does not define how schemas are serialised or transported between the broker and hosts (e.g. as Zod schema objects, serialised JSON Schema, or compiled validators).
- **Host-to-host communication.** The spec defines broker-to-host communication but does not address whether hosts can communicate directly with each other or must route through the broker.
