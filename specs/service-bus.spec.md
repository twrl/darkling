# Service bus

> **This specification has been consolidated into [Runtime](./runtime.spec.md).**
>
> The service bus — the `ServiceBroker`, `ServiceHost`, and `ServiceClient` architecture; service registration and on-demand activation; the service interface contract; the message envelope; Transferable object handling; and promise resolution — is now part of the runtime subsystem governed by [Runtime](./runtime.spec.md). This file is retained as a redirect for existing references; it no longer carries independent normative content.
>
> The mapping of former sections to their new locations:
>
> | Former section                          | New location                                                                          |
> | --------------------------------------- | ------------------------------------------------------------------------------------- |
> | ServiceBroker                           | [Runtime — ServiceBroker](./runtime.spec.md#servicebroker)                            |
> | ServiceHost                             | [Runtime — ServiceHost](./runtime.spec.md#servicehost)                                |
> | ServiceClient                           | [Runtime — RuntimeClient](./runtime.spec.md#runtimeclient)                            |
> | Worker topology                         | [Runtime — Worker topology](./runtime.spec.md#worker-topology)                        |
> | Service registration                    | [Runtime — Service declarations](./runtime.spec.md#service-declarations)              |
> | Declaration module and implementation loading | [Runtime — Declaration module and implementation loading](./runtime.spec.md#declaration-module-and-implementation-loading) |
> | On-demand activation                    | [Runtime — On-demand activation](./runtime.spec.md#on-demand-activation)              |
> | Service interface contract              | [Runtime — Service interface contract](./runtime.spec.md#service-interface-contract)  |
> | Functions                               | [Runtime — Functions](./runtime.spec.md#functions)                                    |
> | Validation                              | [Runtime — Validation](./runtime.spec.md#validation)                                  |
> | Typed proxies                           | [Runtime — Typed proxies](./runtime.spec.md#typed-proxies)                            |
> | Message envelope                        | [Runtime — Message envelope](./runtime.spec.md#message-envelope)                      |
> | Transferable objects                    | [Runtime — Transferable objects](./runtime.spec.md#transferable-objects)              |
> | Promise resolution                      | [Runtime — Promise resolution](./runtime.spec.md#promise-resolution)                  |
> | Conformance                             | [Runtime — Conformance](./runtime.spec.md#conformance)                                |
>
> The consolidation also introduced new concepts not present in the former specification:
>
> - **Behaviours** (fire-and-forget dispatch) — [Runtime — Service interface contract](./runtime.spec.md#service-interface-contract)
> - **Proxy factories** (custom client-side proxies) — [Runtime — Proxy factories](./runtime.spec.md#proxy-factories)
> - **Service initializer** (declaration-driven initialization) — [Runtime — Initialization](./runtime.spec.md#initialization)
> - **Message ordering** (per-service serial processing) — [Runtime — Message ordering](./runtime.spec.md#message-ordering)
> - **Shared state** (slices, mutations, state authority, local copies) — [Runtime — Shared state](./runtime.spec.md#shared-state)
