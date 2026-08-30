# State manager

> **This specification has been consolidated into [Runtime](./runtime.spec.md).**
>
> The state manager — the authority, local copies, the update path, the state model (slices, schemas, invariants), the broadcast protocol, the initialisation protocol, and policy parameters — is now part of the runtime subsystem governed by [Runtime](./runtime.spec.md). This file is retained as a redirect for existing references; it no longer carries independent normative content.
>
> The mapping of former sections to their new locations:
>
> | Former section          | New location                                                                                |
> | ----------------------- | ------------------------------------------------------------------------------------------- |
> | Authority               | [Runtime — State authority](./runtime.spec.md#state-authority)                              |
> | Local copies            | [Runtime — Local copies](./runtime.spec.md#local-copies)                                    |
> | Update path             | [Runtime — Mutation processing](./runtime.spec.md#mutation-processing)                      |
> | State model (slices)    | [Runtime — Slice declarations](./runtime.spec.md#slice-declarations)                        |
> | Immer patches           | [Runtime — Mutation processing](./runtime.spec.md#mutation-processing)                      |
> | Invariants              | [Runtime — Invariants](./runtime.spec.md#invariants)                                        |
> | Update proposals        | [Runtime — Mutation processing](./runtime.spec.md#mutation-processing)                      |
> | Optimistic concurrency  | [Runtime — Optimistic concurrency](./runtime.spec.md#optimistic-concurrency)                |
> | Broadcast protocol      | [Runtime — State-change propagation](./runtime.spec.md#state-change-propagation)            |
> | Gap recovery            | [Runtime — Gap recovery](./runtime.spec.md#gap-recovery)                                    |
> | Initialisation          | [Runtime — Local copies — Initialisation](./runtime.spec.md#initialisation)                 |
> | Reactivity              | [Runtime — Reactivity](./runtime.spec.md#reactivity)                                        |
> | Policy parameters       | [Runtime — Policy parameters](./runtime.spec.md#policy-parameters)                          |
> | Conformance             | [Runtime — Conformance](./runtime.spec.md#conformance)                                      |
>
> Key changes in the consolidated specification:
>
> - **Mutations** replace caller-constructed Immer patches. Consumers call named, typed mutations; the authority derives patches internally. See [Runtime — Slice declarations](./runtime.spec.md#slice-declarations).
> - **The store interface** replaces direct `proposeUpdate`/`getSnapshot` calls. Consumers use a typed store with reactive signals and mutation methods. Basis sequences and stale-basis retries are handled transparently. See [Runtime — Store interface](./runtime.spec.md#store-interface).
> - **The authority is colocated** with the broker (`onBroker: true`), not in a separate dedicated worker. See [Runtime — State authority](./runtime.spec.md#state-authority).
> - **The propagation mechanism** is specified by properties (fan-out, ordering, gap recovery), with `BroadcastChannel` as the reference implementation. See [Runtime — State-change propagation](./runtime.spec.md#state-change-propagation).
