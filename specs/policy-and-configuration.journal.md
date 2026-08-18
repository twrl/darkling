# Journal: Policy and configuration

This journal records the development of [policy-and-configuration.spec.md](./policy-and-configuration.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created in response to a user request to "establish a new high level spec about policy and configuration," prompted by the number of configurable/policy items already mentioned across the existing specifications and several more in mind. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Framework only (cross-cutting contract).** The spec defines the cross-cutting contract for policy parameters generally — they must exist, have defined values, may have defaults, may be overridden, have a lifecycle. It does not enumerate the specific parameters of any subsystem. Each domain spec keeps its own parameter table and references this spec for the structural rules. The alternative (a central catalog of all parameters) was rejected because it would couple this spec to every domain spec's parameters and duplicate the parameter tables.
- **Parameters stay in domain specs.** Each domain spec keeps its own "Policy parameters" table (which parameters exist, their required properties). The new spec defines only the cross-cutting rules that apply to all of them. The alternative (moving all parameter tables into the new spec) was rejected because it would break the co-location of parameters with the behaviour they govern (e.g. budget policy would leave the event system spec, where it is co-designed with the flush policy).
- **Policy + configuration delivery.** The spec covers both policy parameters (normative values that must exist) and configuration (how values are provided/overridden at runtime). "Configuration" is the delivery mechanism for "policy". The alternative (policy contract only, with delivery left entirely to implementation) was rejected because the user wants a uniform delivery mechanism.
- **Require a default profile.** The spec requires that a system-wide default configuration exists (a named default profile) and that overrides apply on top. It doesn't prescribe the default values, just that defaults exist and are documented. The alternative (no default profile requirement) was rejected because without a default, the "all parameters must have defined values" requirement has no baseline.
- **Config source abstraction.** The spec requires a configuration source abstraction (an interface) from which policy values are read. Implementations provide a concrete source (env vars, file, remote config, in-memory). This mirrors the `ContentSource` pattern used by the knowledge-base compiler and keeps the spec platform-neutral and testable. The alternative (construction-time plain objects only) was rejected as less uniform.
- **Static (startup-resolved).** The spec requires that policy values are resolved at startup and remain fixed for the session. Dynamic adjustment is out of scope. The alternative (allowing dynamic adjustment) was rejected as adding a notification/invalidation contract that is not yet needed; it can be established later through the spec workflow if needed.
- **Location.** `specs/policy-and-configuration.spec.md`, matching the existing kebab-case spec naming style.

## Key decisions and rationale

### Extraction and unification of the scattered structural contract

The existing specs each repeat a structural contract for their policy parameters: "This specification defines the parameters that must exist and their required properties; the specific values are implementation-defined and may be configurable. All policy parameters must have defined values. An implementation must not leave any parameter undefined." This appears verbatim in [Event system](./event-system.spec.md#policy-parameters) and [Content-first retrieval](./content-first-retrieval.spec.md#policy-parameters). The new spec extracts this into a single cross-cutting contract that domain specs link to, avoiding duplication and establishing a uniform delivery mechanism.

### Ownership stays with the domain specs

The decision to keep parameter tables in their domain specs (rather than centralising them) preserves the co-design relationship between a parameter and the behaviour it governs. The event-system journal explicitly notes that budget policy is "co-designed" with flush policy and that placing both in the same spec "keeps this co-design explicit" ([event-system.journal.md](./event-system.journal.md#budget-policy-co-located-with-flush-policy)). Moving the budget parameters out would break this. The new spec therefore defines the _rules_ parameters follow, not _which_ parameters exist.

### Default profile as the completeness baseline

The "all parameters must have defined values" requirement needs a baseline to be meaningful: without a default profile, an implementation could satisfy "defined values" by providing values ad hoc with no guarantee of completeness. The default profile gives a single, documented baseline that is guaranteed complete, against which overrides are applied. The spec requires the default profile exists and is complete but does not prescribe its values — those remain implementation-defined.

### Resolution order: override over default

The resolution order is deliberately simple: override takes precedence over default, and an unresolved parameter (neither overridden nor in the default profile) is a conformance failure. This is a two-level order. A more complex order (e.g. environment > file > default) is an implementation concern of the configuration source, not a normative requirement. The spec defines the two-level contract; the configuration source may implement its own internal layering as long as the final resolved value satisfies the override-over-default rule.

### Static resolution keeps the contract simple

Static resolution (resolve once at startup, fixed for the session) avoids a notification/invalidation contract: subsystems receive values at construction and retain them. This is sufficient for the current system. The event-system journal notes that "whether they are fixed, configurable, or dynamically adjusted is left to implementation" ([event-system.journal.md](./event-system.journal.md)); the new spec narrows this to "fixed for the session" as a normative requirement, with dynamic adjustment explicitly out of scope and available via the spec workflow if needed later.

### Configuration source mirrors ContentSource

The configuration source abstraction mirrors the `ContentSource` pattern established by the knowledge-base compiler: a platform-neutral interface from which a subsystem reads what it needs, with concrete implementations provided separately. This is a consistent pattern across the system for injected, platform-neutral dependencies.

## Affected specifications reviewed

- [Event system](./event-system.spec.md) — owns budget and flush policy parameters. The new spec's contract is consistent with the event system's existing "Policy parameters" section; the event system's table and the requirement that all parameters have defined values are preserved. The event system should link to the new spec for the cross-cutting contract. No contradiction.
- [Content-first retrieval](./content-first-retrieval.spec.md) — owns retrieval policy parameters. Same as above; consistent, no contradiction.
- [Constrained agent](./constrained-agent.spec.md) — defers overspend and carryover to "the event system spec or a dedicated policy spec" ([constrained-agent.journal.md](./constrained-agent.journal.md)). The new spec satisfies the "dedicated policy spec" possibility by providing the cross-cutting contract, while the specific overspend/carryover parameters remain in the event system spec. Consistent.
- [Agent safety](./agent-safety.spec.md) — references the cost of `safety_consult` as a policy parameter owned by the event system. The new spec does not change this ownership. Consistent.
- [Service bus](./service-bus.spec.md) — the broker host-launch policy is a broker policy informed by service metadata, not a runtime policy parameter governed by this spec. The new spec's "Relationship to domain specifications" section explicitly excludes it. No contradiction.
- [Authoring tooling](./authoring-tooling.spec.md) — slug collision resolution policy is an implementation detail of compilation, not a runtime policy parameter. The new spec's "Relationship to domain specifications" section explicitly excludes it. No contradiction.

## Gaps and ambiguities

- **Domain spec linkage.** The new spec is established, but the domain specs ([Event system](./event-system.spec.md), [Content-first retrieval](./content-first-retrieval.spec.md)) have not yet been updated to link to it. Their existing "Policy parameters" sections are consistent with the new contract and remain normative for _which_ parameters exist; updating them to link to the new spec for the cross-cutting contract is a follow-up, to be done via the spec workflow or as an editorial linking change.
- **No implementation yet.** The spec is established before any implementation. The `@darkling/knowledge-base` package's `RetrievalPolicy` and `DEFAULT_RETRIEVAL_POLICY` are a partial implementation of the retrieval policy parameters; they do not yet use a configuration source abstraction or a default profile in the form the new spec requires. Conformance of the implementation to the new spec is a follow-up.
- **Configuration source interface shape.** The spec requires a configuration source abstraction but does not prescribe its interface shape (e.g. `get(key)`, typed accessors per subsystem, a resolved config object). This is deliberately left to implementation, consistent with the "framework only" scope decision. It may warrant clarification when the first implementation is built.
- **Future policy parameters.** The user noted "several more in mind" beyond those already mentioned. When those are established in their domain specs, they link to this spec and satisfy its contract. The spec is ready to receive them.
- **Dynamic adjustment.** Explicitly out of scope. If runtime-adjustable policy values become needed (e.g. budget tuning in response to load), a spec change would be required to add a notification/invalidation contract.
