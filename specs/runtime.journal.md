# Journal: Runtime

This journal records the development of [runtime.spec.md](./runtime.spec.md). It is non-normative; the specification takes precedence.

## Origin

This specification consolidates the former [Service bus](./service-bus.spec.md) and [State manager](./state-manager.spec.md) specifications into a single runtime subsystem. The consolidation was initiated by the user, who provided a design proposal (`proposal.md`) and a reference prototype (`/prior-art/bus/`) to inform the specification workflow.

The user explicitly requested working through the specification workflow rather than jumping to implementation: first establishing the existing architecture, identifying affected specifications, then reviewing the proposal and prototype against that context to identify contradictions, open questions, and architectural decisions, before drafting the specification.

## Motivation

The current implementation had reached the point where it was being exercised by the browser-based frontend, exposing integration bugs and unexpected interactions between the Service Bus and State Manager. The implementations were closely coupled — the state authority was a service on the bus, while the state manager relied on the bus's execution and messaging infrastructure — but the boundary between them was specified as a subsystem boundary, making it difficult to maintain and reason about.

An earlier prototype (`/prior-art/bus/`) implemented most of the functionality in a comparatively small and straightforward architecture. While not normative, it provided evidence about which mechanisms are necessary, which abstractions compose naturally, and which complexity may be accidental rather than fundamental.

## Decisions

### Consolidate: state as a first-class runtime capability

The user confirmed that the consolidation is conceptually cleaner, not just organisationally simpler. The key insight: **state mutation is a runtime concern, not a domain service.** The current model's uniformity (everything is a service call) forced the state manager to pretend to be a domain operation, coupling the two specs tightly. Making state a first-class runtime capability — exposed alongside service proxies through a unified client interface — gives a single coherent model.

The "separation" between the bus and state manager in the former specifications was not a real subsystem boundary: the state authority was a service on the bus, dependent on it entirely, with the only independent element being a peer `BroadcastChannel` for patch fan-out. The boundary was a transport-mechanism boundary (command dispatch vs. state fan-out) within a single subsystem's implementation.

### Flux/Vuex model

The user framed the architecture in terms of a multithreaded Flux/Vuex/MVVM model: service calls are equivalent to actions, mutations are mutations, slices are state. This framing guided the specification:

- **actions** (service functions) orchestrate: call other services, commit mutations, return results — but cannot directly modify shared state;
- **mutations** are the only way to change shared state — semantic state-transition functions;
- **state** (slices) is reactive and read-only except through mutations;
- **getters/view models** (selectors) are computed from signals on the consumer side.

### Path B: state authority as a colocated service

Two paths were considered for the state authority:

- **Path A:** Mutations as a distinct message type, the broker short-circuits to a built-in state authority. State is a runtime primitive, not a service.
- **Path B:** State authority as a `colocation: "broker"` service, mutations as function calls on that service. Uniform dispatch mechanism.

The user chose **Path B** for its parsimony and uniform dispatch. The key insight: a colocated service *is* infrastructure — the broker hosting a service locally is not the same as routing a call to a remote worker. The overhead of "pretending to be a service" is minimal when the service is already in-process.

A well-designed client helper (the store interface) gives the consumer the experience of a runtime primitive — typed mutation methods, reactive signals, no patches or basis sequences — while mutations remain service calls under the hood. The user noted: "I think we achieve almost all advantages of Path A just with a well designed client helper."

### Mutations as semantic transitions; patches as implementation detail

The biggest improvement over the former state manager: consumers call named, typed mutations (`store.navigate({document, block})`) rather than constructing Immer patches, tracking basis sequences, and handling `StaleBasisError`. The authority applies the mutation's transition function (an Immer recipe) to the authoritative state, derives patches internally via `produceWithPatches`, and propagates them.

`basisSeq` / `StaleBasisError` remain as an internal protocol between the store helper and the authority. The store helper embeds the local copy's current sequence number transparently and retries on stale basis after local convergence. The consumer never sees basis sequences or stale-basis errors.

### Behaviours: fire-and-forget dispatch

The user identified concrete use cases for fire-and-forget dispatch: avatar animation dispatch (queue an animation, don't wait), agentic event dispatch (queue events for the Guide), and decoupling the UI from the agentic loop (dispatch "run interaction" without awaiting, observe results through reactive state).

Behaviours are semantically distinct from functions whose results are ignored: the runtime does not allocate message-correlation state or expect a return envelope. Delivery is guaranteed; there is no domain-level rejection (only runtime failure). The service controls when to act ("queue for later"). FIFO ordering per service is essential (animations play in sequence, events queue in order).

The user emphasised that behaviours remove the possibility of the UI waiting on the agentic loop — the UI fires intent, renders state, and the Guide's latency is invisible to the UI thread.

### Runtime events: deferred

The proposal included a generic pub/sub mechanism for transient events. After analysis, the user agreed that current use cases are substantially covered by behaviours (targeted fire-and-forget) and reactive signals (state observation). No generic pub/sub mechanism is included in this specification. It can be added as a refinement if a genuine need emerges.

### Host abstraction: broker owns a local ServiceHost

The user refined the host abstraction from the proposal's `ServiceHostIf`/`ServiceHostProxy` split. The key contribution: **the broker owns a local `ServiceHost`, it doesn't pretend to be one.** The local host is a real `ServiceHost` instance sharing the broker's execution context, not a special mode of the broker. This makes the host abstraction structural rather than ceremonial: the broker holds a list of hosts, one local and the rest remote, each commanded uniformly.

The prototype's `ServiceHostService` — a magic service that every host auto-activates for management commands — was replaced with a runtime protocol: the broker commands hosts through `activate`/`deactivate`/`dispatch` on the host interface directly. No magic bootstrap service, no circular routing.

### Colocation policy: `onBroker` boolean

The prototype used `colocation: "broker" | false | string[]` on the service declaration. The user simplified this to `onBroker: boolean` — a hint that the service should run on the broker's local host. Off-broker placement is a broker policy informed by other metadata. The `string[]` case (share with named services) was dropped from the declaration; if the broker wants to colocate services on a shared host, that's a broker policy decision.

### Implementation loader: universal

The `implementationLoader` requirement applies to all services, including colocated ones. The user's reasoning: the client side also consumes service declarations to generate proxies — if the declaration module imported the implementation directly, every proxy consumer would load the implementation. The lazy-loading requirement is not about the host; it's about the declaration module being importable by proxy consumers without pulling in the implementation.

### Proxy factory

The user requested an optional factory function for the proxy in the service declaration. This addresses three categories of client-side logic:

1. **Store builder** — the state authority's proxy factory produces a store builder that wraps raw `mutate`/`getSnapshot` calls with a typed, per-slice store (reactive signals, typed mutations, transparent basis-seq/retry).
2. **Transferable object identification** — the avatar service's proxy factory knows which parameters contain `OffscreenCanvas`/`ImageBitmap` and passes them in the `transfer` list. The runtime does not auto-detect Transferables by introspecting message bodies (non-trivial, expensive, and the caller must opt in to destructive transfer).
3. **Client-side composition** — future cases where a service wants caching, batching, handles, or other conveniences.

The proxy factory receives the `RuntimeClient`'s low-level dispatch primitives (`call`, `behaviour`) and uses them to implement the proxy. The runtime stays generic; the client-side logic lives with the service that needs it.

### Service initializer

The user proposed an initializer — a named behaviour delivered before any other message to the service — to replace the current `HostContext.options` / `registration.options` mechanism. Configuration flows through the initializer's parameters (typed, Zod-validated) rather than an untyped options bag.

Key decisions:
- The initializer is **not** called automatically by the runtime. The application's bootstrap code calls it explicitly.
- The initializer **bypasses the queue** — when a message matching the declared initializer arrives, it is delivered directly to the implementation, ahead of any queued messages. This handles the case where messages arrive before the frontend has called the initializer.
- The initializer must be a **behaviour** (fire-and-forget), not a function — because the runtime gates on delivery, not completion.
- The **broker is not concerned** with initializer semantics. The broker routes to the host and launches on demand as usual. The initializer protocol is entirely a host concern.

### Message ordering: two layers

The user requested clarification of FIFO processing. Two layers were established:

1. **Delivery ordering (runtime):** messages delivered to a host in send order.
2. **Processing ordering (host):** messages to a given service processed strictly serially in delivery order — one at a time, next not started until current completes. Different services on the same host may process concurrently.

This gives the initializer a two-stage guarantee: delivery gate (runtime delivers initializer first) + completion gate (host serial processing ensures initializer completes before anything else starts).

### Registration and discovery

The user proposed a unified registration model where both services and slices have serializable registration records (id + module specifier) used for discovery, while live declarations (Zod schemas, transition functions) are obtained by each context importing the declaration module. This resolves the live-objects problem: registration records cross `postMessage`; live declarations don't.

Key decisions:

- **`registerService` on `RuntimeClient`** — any context with a client can register a service. Registration is synchronous within the broker; once resolved, the service is immediately callable.
- **`registerSlice` on the store builder** — the authority receives the registration, dynamically imports the `*.slice.ts` module to get the live `SliceDeclaration`, and stores it. `registerSlice` resolves when the module is loaded and the slice is ready to process mutations.
- **Registry pseudo-slice** — the authority maintains a built-in pseudo-slice (not declared via `SliceDeclaration`, no mutations, updated directly not through the mutation path) that records all registered services and slices. It uses the same propagation mechanism as regular slices, so all local copies can discover registrations reactively.
- **Dynamic registration** — both services and slices may be registered at any time, not only at bootstrap. A mutation to an unregistered or not-yet-loaded slice must be rejected.
- **`SliceRegistration`** is minimal: `{ id, moduleSpecifier }`. Clients can eagerly or lazily load slice declarations by observing the registry.

### Module conventions: default exports with filename conventions

The user moved to a convention where declaration modules use default exports with filename conventions: `*.service.ts` for service declarations, `*.slice.ts` for slice declarations. This replaces the former named `declaration` export convention. Since declarations are loaded by dynamic import, the default export is the cleanest pattern.

For slices, there is no separate implementation module — the transition functions in the `SliceDeclaration` are the implementation. For services, the `implementationLoader` still wraps a dynamic `import()` pointing to a separate implementation module.

### Service metadata: `requiredSlices` and `initializer`

The user moved the `initializer` from a top-level field on `ServiceDeclaration` into `ServiceMetadata`, alongside a new `requiredSlices` field. This groups all activation-lifecycle concerns in one place: where the service runs (`onBroker`), what it needs before activation (`requiredSlices`), and how it initializes (`initializer`).

### Activation flow: four-state model

With `requiredSlices` and `initializer` both in metadata, the activation flow becomes a four-state model:

```
inactive → activating_1 → activating_2 → active
```

- `activating_1`: implementation instantiated, waiting for required slices to load (host-level gating).
- `activating_2`: required slices loaded, waiting for initializer to be delivered and completed.

Each state is optional: no `requiredSlices` skips `activating_1`; no `initializer` skips `activating_2`; neither transitions directly to active. The host (not the broker) manages these states. The broker routes messages and launches hosts as usual, unaware of activation states.

The initializer is guaranteed to be the first invocation the service receives once all required slices are available. If the initializer arrives during `activating_1`, it queues normally and is extracted when the service transitions to `activating_2`.

### Store builder: registration, discovery, and events

The store builder exposes `registerSlice` for slice registration, `availableSlices()` for reactive discovery, and `store(sliceDeclaration)` for obtaining a typed store. The store builder should implement the `EventEmitter` interface (DOM/Node API sense) so consumers can be notified when slices become available.

### BroadcastChannel: properties, not mechanism

The user did not feel strongly about whether `BroadcastChannel` is normatively mandated or specified by properties. The specification specifies the required properties (fan-out, ordering, gap recovery, separation) and names `BroadcastChannel` as the reference implementation. This is consistent with the project's spec philosophy ("describe required behaviour and observable properties rather than implementation details") and the current package's `PatchChannel` abstraction.

### Worker topology: state authority colocated with broker

The state authority's dedicated worker is eliminated — it's a colocated service in the broker's worker. All other workers remain as established by [Usage and deployment](./usage-and-deployment.spec.md).

The user requested weakening the topology section in `usage-and-deployment.spec.md`: it should specify constraints and properties (broker in a dedicated worker, heavy services in dedicated workers, UI on main thread, backend off-runtime), not a normative enumeration of services. Specific services (Guide, retrieval) are examples, not normative placements.

Terminology: "service host worker" (a Web Worker running a `ServiceHost`) must be disambiguated from "Service Worker" (the browser offline/cache API).

### Removal of slice invariants, mutation source, and cost field

The user decided to remove slice invariant functions, the mutation `source` field, and the `cost` field from the runtime specification, after reviewing the initial `@darkling/runtime` implementation.

**Slice invariants removed.** The invariant mechanism (per-slice invariant functions that could accept or reject a proposed mutation) was removed entirely. Schema validation (Zod validation of the proposed resulting value) remains as the sole acceptance check, folded into [Mutation processing](./runtime.spec.md#mutation-processing) rather than occupying a separate "Invariants" section. The motivating use case for invariants — conflict resolution on the `interface` slice — was already handled at tool-call dispatch time (the `navigate` tool inspects `openedBy` and rejects conflicting Guide navigations before any mutation is committed), as established by [UI](./ui.spec.md#ui-control-tools). The runtime-level invariant mechanism was therefore redundant: controlled mutations (typed transition functions) plus schema validation suffice, and conflict resolution belongs where the action is initiated, not at the state authority.

**Mutation `source` removed.** The `source` field (`ui` | `guide` | `service`) on mutations — previously made available to invariant functions — was removed along with the invariants. The `UpdateSource` type no longer exists in the runtime. The `interface` slice's `openedBy` field (which recorded who opened each tablet) remains, but is now a UI domain concept defined inline in [UI](./ui.spec.md#the-interface-slice) using a local `'ui' | 'guide' | 'service'` enum, not a runtime type.

**`cost` field removed.** The `cost?: number` field on `ServiceFunctionDeclaration` and `ServiceBehaviourDeclaration` was removed from both the spec's type illustration and the implementation. Budget and cost policy is owned by [Constrained agent](./constrained-agent.spec.md); the runtime spec does not need to carry it.

The `StateInvariantError` error type was removed from the implementation. The `InvariantContext`, `InvariantVerdict`, and `UpdateSource` types were removed from `state-model.ts` and from the package's public exports.

One package, `@darkling/runtime`, with internal module boundaries. The strongest argument: the colocated state authority is a service the broker *owns and hosts directly* — that dependency flows inward and shouldn't cross a package boundary. One package also means one consumer dependency, one lit integration, one set of worker entry points, and one package spec conforming to one root spec.

## Affected specifications

The following specifications reference the former Service Bus or State Manager and need cross-reference updates:

- [Service bus](./service-bus.spec.md) — retained as a redirect to this specification.
- [State manager](./state-manager.spec.md) — retained as a redirect to this specification.
- [Usage and deployment](./usage-and-deployment.spec.md) — topology section revised: remove authority worker, rename "service bus" → "runtime", weaken to constraints not enumeration, update startup sequence.
- [UI](./ui.spec.md) — update references from `proposeUpdate`/`LocalCopy`/`<state-manager-host>` to the store interface; update "registered on the service bus" framing.
- [Constrained agent](./constrained-agent.spec.md) — update references to the runtime for tool-call dispatch; note behaviours for fire-and-forget tool calls.
- [Agent safety](./agent-safety.spec.md) — update three references from "service bus" to "runtime".
- [Content-first retrieval](./content-first-retrieval.spec.md) — update one reference from "service bus" to "runtime".
- [Policy and configuration](./policy-and-configuration.spec.md) — update two references for new ownership of host-launch policy.
- `@darkling/service-bus` [package.spec.md](../packages/service-bus/package.spec.md) — superseded by `@darkling/runtime` package spec.
- `@darkling/state-manager` [package.spec.md](../packages/state-manager/package.spec.md) — superseded by `@darkling/runtime` package spec.

## Gaps and open questions

- **Concrete `interface` and `session` slice schemas** remain deferred to refinement, as in the former state manager spec. [UI](./ui.spec.md) establishes the `interface` slice refinement.
- **Signals library / polyfill** is unspecified. The spec requires TC39-signals-compatible API only.
- **Call timeout and stale-basis retry limit** are implementation-defined until a refinement introduces policy parameters.
- **Authority failover / persistence** is not specified. There is a single authority colocated with the broker; restart behaviour is implementation-defined.
- **Service deactivation policy** — the spec states hosts may be deactivated when idle but does not define the idle threshold or deactivation behaviour. This is an implementation concern.
- **Service discovery** — the spec defines registration but not how callers discover available services or their schemas. This may need clarification.
- **Error types** — the spec requires errors to be returned in error message bodies but does not define a full error type taxonomy. Validation errors, host failures, and stale-basis errors are mentioned but the hierarchy is an implementation concern.
- **Schema transport** — the spec requires schemas in declarations but does not define how schemas are serialised between broker and hosts (they import the declaration module directly).
- **Host-to-host communication** — the spec defines broker-to-host communication but does not address whether hosts can communicate directly or must route through the broker.
- **Runtime events (generic pub/sub)** — deferred. May be added as a refinement if a genuine need emerges.