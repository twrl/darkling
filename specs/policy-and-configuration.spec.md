# Policy and configuration

## Purpose and scope

This specification defines the cross-cutting structural contract for policy parameters across the Darkling system: the rules that govern how policy parameters are declared and documented, wherever they appear.

It governs:

- the definition of a policy parameter — what it is, and the structural requirements every policy parameter must satisfy;
- the relationship between this specification and the domain specifications that own their own policy parameter tables.

It is explicitly out of scope for this specification to define:

- the specific policy parameters of any subsystem — which are defined by their respective domain specifications;
- the specific values of any policy parameter — which are implementation-defined;
- the behaviour that a policy parameter governs — which is defined by the domain specification that owns the parameter;
- the configuration delivery mechanism — the configuration source, default profile, resolution order, and static resolution are defined by [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api);
- dynamic adjustment of policy values at runtime — which is out of scope; policy values are static for the session, as defined in [Usage and deployment](./usage-and-deployment.spec.md#static-resolution).

Where this specification depends on behaviour defined by domain specifications, it links to them and states its requirement in terms of their observable behaviour. Where domain specifications define policy parameters, they link to this specification for the structural contract that those parameters satisfy, and to [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api) for the delivery mechanism by which values are read, resolved, and provided to subsystems.

## Design context

Several domain specifications govern behaviour whose specific values are implementation-defined: [Constrained agent](./constrained-agent.spec.md) owns budget and flush policy parameters; [Content-first retrieval](./content-first-retrieval.spec.md) owns retrieval policy parameters; [Agent safety](./agent-safety.spec.md) references the cost of `safety_consult` as a policy parameter; [Runtime](./runtime.spec.md) references broker host-launch policy. Each of those specifications defines _which_ parameters exist and _what_ they govern, and requires that they have defined values, but leaves the specific values to implementation.

This specification extracts and unifies the structural rules common to all of those scattered policy parameters: that they must exist, must have defined values, and must conform to a type. The delivery mechanism by which values are read, resolved, and provided to subsystems is defined by [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api). This avoids duplicating the structural contract across domain specs and provides a single place to reason about what a policy parameter is.

The ownership of each parameter remains with the domain specification that defines the behaviour it governs. This specification does not enumerate or move those parameters; it defines the structural contract they all satisfy.

## Policy parameters

A **policy parameter** is a named, implementation-defined value that governs a specific aspect of a subsystem's behaviour. The domain specification that owns the behaviour defines the parameter: its name, its required properties, and what it governs.

Every policy parameter, wherever it is defined, must satisfy the following structural requirements:

- **Existence.** The parameter must be defined by its owning domain specification. A subsystem must not read a policy parameter that its owning specification has not defined.
- **Defined value.** The parameter must have a defined value at runtime. An implementation must not leave any policy parameter undefined. A subsystem that reads a policy parameter must receive a value.
- **Type.** The parameter's value must conform to the type established by its owning specification (e.g. a probability in the range [0.0, 1.0], a non-negative integer, a function). A value that does not conform must be rejected at resolution time, as defined in [Usage and deployment](./usage-and-deployment.spec.md#resolution-order).
- **Documentation.** The parameter must be documented in its owning specification's policy parameter table, including its name and a description of what it governs.

```gherkin
Feature: Policy parameters
  Rule: Every policy parameter must exist, have a defined value, and conform to its type

  Scenario: A defined parameter has a value
    Given the constrained agent specification defines the "Budget base" parameter
    And the configuration source provides a value for "Budget base"
    When the constrained agent reads "Budget base"
    Then it must receive the provided value

  Scenario: An undefined parameter is not read
    Given no specification defines a parameter named "colour-scheme"
    When a subsystem attempts to read "colour-scheme"
    Then the attempt must fail
    And the parameter must not be admitted into the configuration

  Scenario: A parameter with an invalid value is rejected
    Given the constrained agent specification defines "Trigger probability" with type "number in [0.0, 1.0]"
    And the configuration source provides the value 1.5 for "Trigger probability"
    When the configuration is resolved
    Then the value 1.5 must be rejected
    And the rejection must be reported
```

## Relationship to domain specifications

Domain specifications own their policy parameters. This specification defines the structural contract that those parameters satisfy; the delivery mechanism by which values are read, resolved, and provided to subsystems is defined by [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api). Where a domain specification defines policy parameters, it must:

- define the parameters that must exist and their required properties (name, type, what they govern);
- require that the parameters have defined values, as defined in [Policy parameters](#policy-parameters);
- link to this specification for the structural contract, and to [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api) for the configuration source, default profile, resolution order, and static resolution.

The following domain specifications define policy parameters and are subject to this contract:

- [Constrained agent](./constrained-agent.spec.md#policy-parameters) — trigger probabilities, budget composition, tool call costs, overspend, and carryover parameters.
- [Content-first retrieval](./content-first-retrieval.spec.md#policy-parameters) — filterable properties, match semantics, text search mechanism, ranking function, default result limit, and default sort policy.
- [Usage and deployment](./usage-and-deployment.spec.md#cost-and-abuse-controls) — per-session spend caps, global rate limits (both tier-dependent), and session state persistence policies per access tier. These are resolved at startup as defined in [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api).

Other specifications reference policy parameters without a dedicated table:

- [Agent safety](./agent-safety.spec.md#relationship-to-the-budget) — the cost of `safety_consult`, owned by the [Constrained agent](./constrained-agent.spec.md#policy-parameters) tool call costs parameter.
- [Runtime](./runtime.spec.md#on-demand-activation) — the broker host-launch policy, which is a broker policy informed by service metadata, not a policy parameter governed by this specification.
- [Authoring tooling](./authoring-tooling.spec.md#slug-uniqueness) — slug collision resolution policy, which is an implementation detail of compilation rather than a runtime policy parameter.

A domain specification that introduces new policy parameters must link to this specification and satisfy this contract. This specification does not enumerate the parameters; it defines the rules they follow.

## Conformance

An implementation conforms to this specification when:

- every policy parameter defined by the domain specifications has a defined value at runtime, conforming to the type established by its owning specification;
- a policy value that does not conform to its parameter's type is rejected at resolution time and reported;
- the domain specifications that define policy parameters link to this specification for the structural contract and to [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api) for the delivery mechanism.

The delivery mechanism — configuration source, default profile, resolution order, and static resolution — is defined by [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api); conformance to those requirements is established there.
