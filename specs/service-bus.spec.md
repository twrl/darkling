# Service bus

## Purpose and scope

This specification defines the service bus: the communication substrate by which services running across Web Workers are activated on demand and invoked through message passing. The service bus is the execution layer over which the Guide's tool calls are dispatched, the event system operates, and the retrieval interface is accessed.

It governs:

- the `ServiceBroker`, `ServiceHost`, and `ServiceClient` architecture;
- the Web Worker topology;
- service registration and on-demand activation;
- the service interface contract;
- the message envelope structure and routing;
- Transferable object handling;
- promise resolution and error propagation.

It is explicitly out of scope for this specification to define:

- the specific services that run on the bus (retrieval, UI control, avatar interaction, etc.) — which are defined by their respective domain specifications;
- the constrained agent's tool-call discipline, tool categories, and budget — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the event system — which is defined by [Event system](./event-system.spec.md);
- the content model and retrieval interface — which are defined by [Content model](./content-model.spec.md) and [Content-first retrieval](./content-first-retrieval.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Architecture

The service bus consists of a `ServiceBroker`, zero or more `ServiceHost` instances, and a `ServiceClient` available to callers.

### ServiceBroker

The `ServiceBroker` runs in a Web Worker. It is the central routing and coordination point for the service bus.

- The broker routes messages between service clients and service hosts.
- The broker maintains the service registry, as defined in [Service registration](#service-registration).
- The broker decides when to launch a new host and when to activate a service, and on which host, as defined in [On-demand activation](#on-demand-activation).
- The broker handles Transferable objects in message envelopes, as defined in [Transferable objects](#transferable-objects).
- The broker routes return and error messages back to the `ServiceClient` that issued the corresponding call, correlated by message ID. The `ServiceClient` handles promise resolution, as defined in [Promise resolution](#promise-resolution).

### ServiceHost

Each `ServiceHost` runs in a dedicated Web Worker. A host may support multiple services.

- A host receives messages from the broker, dispatches them to the appropriate service function, and returns the result.
- A host is launched and activated by the broker on demand, as defined in [On-demand activation](#on-demand-activation).
- A host may be deactivated when idle, as an implementation concern.

### ServiceClient

The `ServiceClient` is the caller-side component of the service bus. It is available both on the main thread and to any service running on a host, enabling services to invoke other services.

- The `ServiceClient` creates typed, validating proxies on demand from service declarations, as defined in [Typed proxies](#typed-proxies).
- The `ServiceClient` handles promise resolution: it issues calls to the broker, correlates return and error messages by message ID, and resolves or rejects the caller's promise, as defined in [Promise resolution](#promise-resolution).
- A caller — whether on the main thread or within a service — obtains a proxy from the `ServiceClient` and invokes service functions through it. The `ServiceClient` manages the underlying message envelope, routing, and promise lifecycle.

### Worker topology

The broker and each host run in separate Web Workers. The `ServiceClient` runs on the caller's thread — the main thread or within a service host's worker. This means:

- service execution is isolated from the main thread and from other services;
- services execute concurrently, since each host is in its own worker;
- the `ServiceClient` is available wherever calls originate, without requiring a dedicated worker;
- communication between the `ServiceClient`, broker, and hosts uses `postMessage` with message envelopes, as defined in [Message envelope](#message-envelope).

The location where a service is running — which host, whether the host is in a dedicated worker or shared with other services — is transparent to a consumer. A consumer invokes a service by its identifier; the broker routes the call to the appropriate host. The consumer must not depend on knowledge of which host executes a service.

## Service registration

### Interface and metadata separate from implementation

Each service declares its interface and metadata separately from its implementation. The declaration is registered with the broker; the implementation runs on a host.

- A service declaration must include:
  - a **service identifier** — a unique name for the service;
  - a **schema declaration** — the parameter and return type schemas for the service's functions, as defined in [Service interface contract](#service-interface-contract);
  - **metadata** — service-level metadata (e.g. cost hints, capabilities, host requirements) used by the broker for routing and activation decisions.
- The service implementation is not part of the declaration. The broker uses the declaration to route calls and validate messages; the host loads and executes the implementation.
- A service may expose multiple functions, each with its own parameter and return schemas.

### Service registry

The broker maintains a service registry of service declarations.

- Each service must be registered with the broker before it can be invoked.
- The registry maps service identifiers to their declarations (interface and metadata), not to specific host instances. The broker decides which host executes a service at dispatch time, as defined in [On-demand activation](#on-demand-activation).

### On-demand activation

The broker decides when to launch a new host and when to activate a service, and on which host.

- When a call is made to a service, the broker determines whether a host capable of executing the service is already active. If not, the broker launches a new host (or activates the service on an existing host) before dispatching the call.
- A host may support multiple services. The broker may activate a service on an existing host that supports it, rather than launching a new host.
- The decision of when to launch a new host versus activating a service on an existing host is a broker policy, informed by service metadata. This specification requires that the broker makes the decision; it does not prescribe the policy.
- Activation must be transparent to the caller: the caller's promise is fulfilled when the call returns, regardless of whether a host was launched or a service was activated. The caller must not know which host executed the call.
- A host may be deactivated after a period of idleness. Deactivation is an implementation concern; this specification requires only that a deactivated host can be reactivated on demand.

```gherkin
Feature: On-demand activation
  Rule: The broker decides when to launch hosts and activate services, transparent to the caller

  Scenario: First call launches a host
    Given a service "retrieval" is registered with the broker
    And no host capable of executing "retrieval" is active
    When a caller invokes a function on "retrieval"
    Then the broker must launch a host capable of executing "retrieval"
    And the call must be dispatched to the host once active
    And the caller's promise must be fulfilled when the function returns

  Scenario: Service activated on existing host
    Given a host is active and supports services "retrieval" and "annotations"
    And service "annotations" is not yet activated on the host
    When a caller invokes a function on "annotations"
    Then the broker must activate "annotations" on the existing host
    And no new host must be launched
    And the caller's promise must be fulfilled when the function returns

  Scenario: Location is transparent to the caller
    Given a service "retrieval" is registered with the broker
    When a caller invokes a function on "retrieval"
    Then the caller must not know which host executed the call
    And the caller's promise must be fulfilled with the return value
```

## Service interface contract

A service is a collection of functions. Each function takes an object (the parameter) and returns a promise for an object (the return value).

- **Parameter** — a single object, validated against the function's parameter schema.
- **Return** — a promise for a single object, validated against the function's return schema.
- **Schemas** — parameter and return types are expressed using Zod 4 schemas. The specific schemas are defined by each service's definition and are an implementation detail of the service. This specification requires that schemas exist and are used for validation; it does not prescribe the schemas themselves.

### Validation

- The broker (or host) must validate the parameter against the function's parameter schema before dispatching the call. A parameter that fails validation must cause the call to be rejected with a validation error.
- The host must validate the return value against the function's return schema before returning it. A return value that fails validation must cause the call to be rejected with a validation error.

```gherkin
Feature: Service interface contract
  Rule: Functions take an object, return a promise for an object, validated by schema

  Scenario: Successful invocation
    Given a service function with parameter schema P and return schema R
    When a caller invokes the function with a value matching P
    Then the function must execute
    And the return value must match R
    And the caller's promise must be fulfilled with the return value

  Scenario: Parameter validation failure
    Given a service function with parameter schema P
    When a caller invokes the function with a value not matching P
    Then the call must be rejected with a validation error
    And the caller's promise must be rejected
```

### Typed proxies

Because the service interface is declared separately from its implementation, the `ServiceClient` can create typed, validating proxies on demand from service declarations.

- A caller obtains a proxy from the `ServiceClient` by requesting one for a service identifier. The `ServiceClient` constructs the proxy from the service's declared interface.
- A proxy presents the service's functions as typed methods, with parameter and return types derived from the service's Zod 4 schemas. The proxy provides compile-time type safety and IDE support for service consumers.
- A proxy may validate parameters against the schema before dispatching the call to the broker, providing early validation at the call site rather than only at the broker or host.
- A proxy may validate return values against the schema before resolving the promise to the caller, providing end-to-end type safety.
- The generation of proxies from declarations is an implementation detail; this specification requires that the `ServiceClient` creates proxies on demand from declared interfaces. The specific proxy generation mechanism (code generation, runtime construction, or a combination) is not prescribed.

Proxies do not change the service bus contract: a proxy wraps the `ServiceClient`'s promise-based invocation, adding typing and optional validation. The underlying message envelope, routing, and promise resolution behave identically whether or not a proxy is used.

## Message envelope

Messages between the broker, hosts, and callers are wrapped in SOAPjr-style envelopes. An envelope consists of a head and a body.

### Head

The head carries routing metadata. It must include:

- **message ID** — a unique identifier for the message, used to correlate calls with returns;
- **service identifier** — the service being invoked;
- **function name** — the function being called on the service;
- **message type** — one of `call`, `return`, or `error`, indicating the kind of message;
- **transferables** — a list of paths referencing Transferable objects within the body, as defined in [Transferable objects](#transferable-objects). If the body contains no Transferable objects, this field must be an empty list.

The head may include additional metadata. The specific fields beyond those required here are an implementation detail.

### Body

The body carries the payload:

- for a `call` message, the body is the parameter object;
- for a `return` message, the body is the return value;
- for an `error` message, the body is the error description.

### Routing

The broker uses the head to route messages:

- a `call` message is routed to the host assigned to the service identified in the head;
- a `return` or `error` message from a host is routed back to the `ServiceClient` that issued the corresponding `call`, correlated by message ID.

```json
{
  "head": {
    "messageId": "msg-001",
    "service": "retrieval",
    "function": "getById",
    "type": "call",
    "transferables": []
  },
  "body": {
    "id": "ceph-biology:overview"
  }
}
```

## Transferable objects

Message envelopes may carry Transferable objects — objects whose ownership can be transferred between workers without copying, such as `ArrayBuffer`.

- When a message body contains Transferable objects, the head's `transferables` field must list them. This field is passed verbatim as the `transfer` parameter to `postMessage` when the message is posted between workers.
- The `transferables` field contains references to the Transferable objects within the body, in the format expected by `postMessage`'s `transfer` parameter. The broker and hosts must pass this field directly to `postMessage` without modification.
- If the body contains no Transferable objects, the `transferables` field must be an empty list.
- After transfer, the sender's reference to the Transferable object is detached, as per the Web Worker `postMessage` contract. Services must not assume continued access to a transferred object on the sender's side.
- The transfer must be transparent to the service interface: the function's parameter and return schemas describe the logical object; the transfer mechanism is an envelope-handling concern, not a service contract concern.

```gherkin
Feature: Transferable objects
  Rule: Transferable objects are referenced in the head and passed verbatim to postMessage

  Scenario: Transferring an ArrayBuffer
    Given a call message body contains an ArrayBuffer at path body.data
    When the broker posts the message to a host
    Then the head's transferables field must reference body.data
    And the transferables field must be passed verbatim as the transfer parameter to postMessage
    And the ArrayBuffer must be transferred to the host
    And the sender's reference to the ArrayBuffer must be detached
    And the host must receive the ArrayBuffer in the message body

  Scenario: No Transferable objects
    Given a call message body contains no Transferable objects
    When the broker posts the message to a host
    Then the head's transferables field must be an empty list
    And postMessage must be called with an empty transfer list
```

## Promise resolution

The `ServiceClient` handles promise resolution for callers. It issues calls to the broker, correlates return and error messages by message ID, and resolves or rejects the caller's promise.

- When the broker routes a `return` message to the `ServiceClient` for a call, the `ServiceClient` must resolve the caller's promise with the return value from the message body.
- When the broker routes an `error` message to the `ServiceClient` for a call, the `ServiceClient` must reject the caller's promise with the error from the message body.
- If a host is unavailable or fails to respond, the `ServiceClient` must reject the caller's promise with an error indicating the failure.

The caller interacts with the service bus through the `ServiceClient`'s proxies and promises; the envelope routing and worker communication are hidden behind the proxy and promise interface.

```gherkin
Feature: Promise resolution
  Rule: The ServiceClient resolves or rejects promises based on service returns

  Scenario: Successful return resolves promise
    Given a caller has invoked a function through a ServiceClient proxy
    When the broker routes a return message to the ServiceClient
    Then the ServiceClient must resolve the caller's promise with the return value

  Scenario: Error rejects promise
    Given a caller has invoked a function through a ServiceClient proxy
    When the broker routes an error message to the ServiceClient
    Then the ServiceClient must reject the caller's promise with the error

  Scenario: Host failure rejects promise
    Given a caller has invoked a function through a ServiceClient proxy
    And the host fails to respond
    Then the ServiceClient must reject the caller's promise with a failure error
```

## Relationship to other specifications

The service bus is the execution substrate for several other specifications:

- **Tool call dispatch** — the Guide's tool calls, as defined by [Constrained agent](./constrained-agent.spec.md), are dispatched through the service bus. Each tool category (avatar interaction, UI control, knowledge base access, agent self) is backed by services on the bus. Parallel dispatch of tool calls within a turn, as required by the constrained agent spec, is supported by the concurrent execution of service hosts in separate workers.
- **Retrieval** — the retrieval interface, as defined by [Content-first retrieval](./content-first-retrieval.spec.md), is accessed through services on the bus. The block store, property index, text index, relationship index, and containment index are backed by services.
- **Event system** — the event system, as defined by [Event system](./event-system.spec.md), produces and queues events. Event production and queue management may be implemented as services on the bus.

This specification defines the bus; the specific services are defined by their respective domain specifications.

## Conformance

An implementation conforms to this specification when:

- a `ServiceBroker` runs in a Web Worker and routes messages between service clients and service hosts;
- zero or more `ServiceHost` instances run in dedicated Web Workers and may each support multiple services;
- a `ServiceClient` is available both on the main thread and to any service, creates typed proxies on demand from service declarations, and handles promise resolution;
- each service declares its interface and metadata separately from its implementation, registered with the broker;
- the broker decides when to launch a new host and when to activate a service and on which host, informed by service metadata;
- the location where a service is running is transparent to a consumer;
- service functions take an object and return a promise for an object, with parameters and returns validated against Zod 4 schemas;
- the `ServiceClient` creates typed, validating proxies from declared interfaces, available to client code;
- messages are wrapped in envelopes with a head (message ID, service identifier, function name, message type, transferables) and a body (payload);
- the broker routes messages using the head and correlates returns to calls by message ID;
- the `ServiceClient` resolves or rejects caller promises based on return or error messages routed by the broker, and rejects on host failure;
- Transferable objects in message bodies are referenced in the head's `transferables` field, which is passed verbatim as the `transfer` parameter to `postMessage`.
