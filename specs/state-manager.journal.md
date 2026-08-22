# State manager — journal

## Creation

Created as the eleventh specification via the specification workflow. The user proposed a state-manager service that receives proposed updates, maintains invariants, and broadcasts accepted updates as Immer patches over a `BroadcastChannel`, with immutable local copies per thread using TC39 signals for reactivity.

This journal records the consequential design decisions and the tensions resolved during the specification dialogue.

## Decisions

### Hybrid bus/channel topology

The user selected a **hybrid** relationship: proposed updates go through the service bus (for typed, validated invocation and synchronous accept/reject), and accepted patches broadcast over a separate `BroadcastChannel`. This matches the distinct communication patterns: command-style invocations (bus) vs. one-to-many state fan-out (channel). The authority is a service on the bus, not a peer subsystem.

Rationale: reusing the bus for proposals gives typed proxies, Zod validation, promise resolution, and the existing worker-routing machinery for free. Using a peer `BroadcastChannel` for patches avoids round-tripping every patch through the broker and gives native fan-out to all threads. Keeping the two channels separate also prevents command/state mixing.

### Dedicated-worker authority

The user selected a **dedicated worker** for the authority. Consistent with the broker/Guide/retrieval worker topology in `usage-and-deployment.spec.md`. The authority is a single process; there is no secondary authority and no failover model in this spec.

### Fixed slices; mechanism now, fields later

The user selected **fixed slices** (declared up front, no dynamic registration) and **mechanism now, fields later**. The spec declares that `interface` and `session` slices exist, names their concerns, and defines the invariant mechanism, but defers their concrete Zod schemas and invariant functions to a refinement. Until a refinement defines a slice's schema, its value is `unknown` and its invariants are empty; the mechanism applies uniformly.

### State scope: interface + session/runtime only

The user selected `interface` and `session` slices, and explicitly did **not** select working memory or retrieval/cache state. Working memory remains owned by `constrained-agent.spec.md` (the Guide's mutable, cross-interaction JSON state is not shared state). Retrieval/cache state remains owned by `content-first-retrieval.spec.md`. The state manager holds only state genuinely shared across threads.

### Update sources: UI, Guide, services

All three actor classes may propose updates. The proposal's `source` field (`ui` | `guide` | `service`) is made available to slice invariants so conflict-resolution invariants can distinguish User-sourced from Guide-sourced updates.

### Generic substrate, with conflict resolution as a motivating use case

The user selected **generic substrate only** for the three-way-interaction overlap — this spec is a generic shared-state substrate and does not address Navigate/Draw-attention specifically — but also selected **conflict resolution** as an invariant category. These were reconciled as follows:

- Schema validity is the always-enforced invariant category.
- Slice invariants are a per-slice invariant-function hook (the mechanism), whose motivating use case is conflict resolution on the `interface` slice.
- The conflict-resolution *rules* themselves (User precedence, non-preemption, Guide continuity) are normative in `three-way-interaction.spec.md`; the `interface` slice's invariants *enforce* them using the proposal's `source`, they do not redefine them.
- The concrete `interface` slice invariants are deferred to a refinement.

This keeps this spec as a generic substrate while still defining the mechanism by which conflict resolution is enforced, without moving ownership of the interface operations out of `three-way-interaction.spec.md`.

The user did not select the custom per-slice invariant category explicitly; the slice-invariant mechanism is included here as the single, unified hook through which all non-schema invariants (including conflict resolution) are expressed, rather than as a separate "custom" category. This was inferred from the combination of selections; flagged here for review.

### Immutable snapshot + signals (no mandated granularity)

The user selected **immutable snapshot + signals**: each patch rewrites the local immutable snapshot; signals wrap reads; the spec does not mandate subscription granularity (per-slice, per-path, or single root signal). This is deliberately permissive on the signals side: it requires only TC39-signals-compatible reactivity and that patch application invalidates the signals reading the affected slice, leaving the granularity to implementation.

### Authority serialises (no optimistic local copies)

The user selected **authority serialises**: only the authority accepts updates; rejected proposals never broadcast; local copies converge by applying patches in arrival order. No optimistic local updates, no CRDT/merge semantics, no local mutation other than applying received patches (local copies are pure mirrors with respect to mutation).

### Fetch-on-boot initialisation

The user selected **fetch on boot**: local copies fetch the initial full state from the authority via `getSnapshot`, then switch to the patch stream. Not snapshot-on-subscribe and not persisted.

### Optimistic concurrency via basis sequence number

Proposals carry a `basisSeq` (the sequence number of the slice at which the proposer generated its patch). The authority rejects with `StaleBasisError` when `basisSeq` does not equal the slice's current sequence number. This makes staleness explicit up front rather than relying on schema/invariant failure to surface it, and tells the proposer to refresh and recompute its patch. This was inferred from the selected design (updates flow through the bus with synchronous feedback, local copies are pure mirrors) rather than asked directly; flagged here for review.

### Reject via bus call (synchronous feedback)

The user selected **reject via bus call**: a rejected proposal rejects the `proposeUpdate` call's promise with a `ServiceBusError` and a reason; accepted proposals resolve with an ack carrying the assigned sequence number. Fire-and-forget was not selected. This falls out of bus semantics; the spec adds the rejection-reason taxonomy (`StaleBasisError`, validation error, invariant rejection).

### Sequence + re-fetch on gap

The user selected **sequence + re-fetch on gap**: each patch message carries a monotonic per-slice sequence number; a local copy detecting a gap (seq > last-known + 1) re-fetches via `getSnapshot` and resumes from the fresh sequence number, buffering messages received while the re-fetch is in flight. Duplicates (seq ≤ last-known) are ignored.

## Gaps and open questions

- **Concrete `interface` and `session` slice schemas + invariants** are deferred to a refinement of this spec. Until then, slices are `unknown`-valued with empty invariants. The mechanism is fully specified; the slice contents are not. A refinement should define the `interface` slice's fields (current document, attention target, etc.) and its conflict-resolution invariants encoding `three-way-interaction.spec.md`, and the `session` slice's fields (interaction status, connection state, etc.).
- **Signals library / polyfill** is unspecified. The spec requires TC39-signals-compatible API only.
- **Re-fetch behaviour during gaps** is specified at the protocol level (buffer, then apply in order, discarding stale seqs), but backoff/retry of the `getSnapshot` call on failure is left to implementation.
- **Authority failover / persistence** is not specified. There is a single authority in a dedicated worker; restart behaviour is implementation-defined. If cross-session continuity is needed, it would require an extension to this spec or coordination with `usage-and-deployment.spec.md` (which already places working-memory persistence in IndexedDB).
- **Whether `getSnapshot` should be a single call for all slices or per-slice** is left as an API-shape decision for the implementation/refinement. The spec speaks of per-slice fetches.
- **Custom per-slice invariant category** was offered but not explicitly selected; the slice-invariant mechanism is included as the unified hook. To be confirmed in review.

## Overlaps with other specifications

- `service-bus.spec.md` — the authority is a service on the bus; `proposeUpdate`/`getSnapshot` use `ServiceDeclaration`/`ServiceImplementation` and bus promise resolution. The `BroadcastChannel` is a peer, not part of the bus transport.
- `three-way-interaction.spec.md` — owns the interface operations and conflict-resolution rules. This spec's `interface` slice invariants enforce them; they do not redefine them.
- `constrained-agent.spec.md` — owns working memory, which is explicitly out of scope for shared state.
- `usage-and-deployment.spec.md` — defines worker topology; the authority runs in a dedicated worker consistent with it.
- `policy-and-configuration.spec.md` — owns the policy-parameter contract; this spec declares the `Broadcast channel name` parameter.