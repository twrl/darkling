# Policy and configuration

## Purpose and scope

This specification defines the cross-cutting contract for policy parameters and configuration across the Darkling system: the rules that govern how policy parameters are declared, resolved, provided to subsystems, and documented, wherever they appear.

It governs:

- the definition of a policy parameter — what it is, and the structural requirements every policy parameter must satisfy;
- the configuration source abstraction — the mechanism by which policy values are read and delivered to subsystems;
- the default profile — the system-wide default configuration that must exist and against which overrides are applied;
- the resolution order — how a policy value is resolved from the default profile and configuration source overrides;
- the static-resolution requirement — policy values are resolved at startup and remain fixed for the session;
- the relationship between this specification and the domain specifications that own their own policy parameter tables.

It is explicitly out of scope for this specification to define:

- the specific policy parameters of any subsystem — which are defined by their respective domain specifications;
- the specific values of any policy parameter — which are implementation-defined;
- the behaviour that a policy parameter governs — which is defined by the domain specification that owns the parameter;
- dynamic adjustment of policy values at runtime — which is out of scope; policy values are static for the session, as defined in [Static resolution](#static-resolution).

Where this specification depends on behaviour defined by domain specifications, it links to them and states its requirement in terms of their observable behaviour. Where domain specifications define policy parameters, they link to this specification for the cross-cutting contract that those parameters satisfy.

## Design context

Several domain specifications govern behaviour whose specific values are implementation-defined: [Constrained agent](./constrained-agent.spec.md) owns budget and flush policy parameters; [Content-first retrieval](./content-first-retrieval.spec.md) owns retrieval policy parameters; [Agent safety](./agent-safety.spec.md) references the cost of `safety_consult` as a policy parameter; [Service bus](./service-bus.spec.md) references broker host-launch policy. Each of those specifications defines _which_ parameters exist and _what_ they govern, and requires that they have defined values, but leaves the specific values to implementation.

This specification extracts and unifies the structural rules common to all of those scattered policy parameters: that they must exist, must have defined values, must be resolvable through a configuration source, and must have a system-wide default. This avoids duplicating the structural contract across domain specs, establishes a uniform delivery mechanism, and provides a single place to reason about how policy values are provided to subsystems.

The ownership of each parameter remains with the domain specification that defines the behaviour it governs. This specification does not enumerate or move those parameters; it defines the contract they all satisfy.

## Policy parameters

A **policy parameter** is a named, implementation-defined value that governs a specific aspect of a subsystem's behaviour. The domain specification that owns the behaviour defines the parameter: its name, its required properties, and what it governs.

Every policy parameter, wherever it is defined, must satisfy the following structural requirements:

- **Existence.** The parameter must be defined by its owning domain specification. A subsystem must not read a policy parameter that its owning specification has not defined.
- **Defined value.** The parameter must have a defined value at runtime. An implementation must not leave any policy parameter undefined. A subsystem that reads a policy parameter must receive a value.
- **Type.** The parameter's value must conform to the type established by its owning specification (e.g. a probability in the range [0.0, 1.0], a non-negative integer, a function). A value that does not conform must be rejected at resolution time, as defined in [Resolution order](#resolution-order).
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

## Configuration source

Policy values are read from a **configuration source**: an abstraction from which the resolved values of policy parameters are obtained. The configuration source is platform-neutral; the specific source is an implementation concern.

- The configuration source must provide a value for every policy parameter defined by the domain specifications, after applying the resolution order defined in [Resolution order](#resolution-order).
- The configuration source must reject values that do not conform to the type of their parameter, as defined by the owning specification, and report the rejection.
- The configuration source must be read-only with respect to the subsystems that consume it: subsystems read values from the source but must not alter it.
- The specific configuration source implementation is an implementation concern. An implementation may provide a source backed by environment variables, a configuration file, a remote configuration service, an in-memory object, or any combination. The abstraction keeps the system platform-neutral and testable, mirroring the [ContentSource](../packages/knowledge-base/package.spec.md#compiler-subpath-darklingknowledge-basecompiler) pattern used by the compiler.

### Provision to subsystems

Subsystems obtain their policy values from the configuration source at construction time. Each subsystem declares the policy parameters it reads; the configuration source provides the resolved values for those parameters. This keeps subsystems decoupled from the configuration source's implementation and from parameters they do not consume.

- A subsystem must not read a policy parameter that its owning specification has not defined.
- A subsystem must receive its policy values at construction time, as defined in [Static resolution](#static-resolution).

```gherkin
Feature: Configuration source
  Rule: Policy values are read from a configuration source and provided to subsystems at construction time

  Scenario: A subsystem receives its policy values
    Given the retrieval subsystem declares parameters "Default result limit" and "Default sort policy"
    And the configuration source provides values for both
    When the retrieval subsystem is constructed
    Then it must receive the provided values

  Scenario: A subsystem does not read parameters it does not own
    Given the retrieval subsystem declares "Default result limit"
    And the constrained agent owns "Budget base"
    When the retrieval subsystem is constructed
    Then it must not read "Budget base"

  Scenario: An invalid value is rejected at resolution
    Given the configuration source provides an invalid value for a parameter
    When the configuration is resolved
    Then the value must be rejected
    And the subsystem must not receive the invalid value
```

## Default profile

A **default profile** is a named, system-wide default configuration that provides a value for every policy parameter defined by the domain specifications. The default profile is the baseline against which overrides are applied.

- The system must provide a default profile. The default profile must provide a value for every policy parameter defined by the domain specifications; it must not leave any parameter undefined.
- The default profile must be documented. The documentation must identify the profile by name and state that it is the system default.
- The default profile's values must conform to the types established by the owning specifications.
- The specific values of the default profile are implementation-defined. This specification requires that a default profile exists and is complete; it does not prescribe the values.

### Overrides

A configuration source may provide values that override the default profile. When an override is provided for a parameter, the override's value takes precedence over the default profile's value, subject to the resolution order.

- An override must conform to the type of the parameter it overrides; an invalid override must be rejected and reported, as defined in [Configuration source](#configuration-source).
- An override may be provided for some parameters and not others; parameters without an override retain the default profile's value.

```gherkin
Feature: Default profile
  Rule: A system-wide default profile provides a value for every parameter; overrides apply on top

  Scenario: Default profile is complete
    Given the domain specifications define parameters P1 and P2
    And the default profile provides values for P1 and P2
    When the configuration is resolved with no overrides
    Then the resolved values must be the default profile's values

  Scenario: Override takes precedence
    Given the default profile provides value D for parameter P
    And the configuration source provides override value O for P
    When the configuration is resolved
    Then the resolved value for P must be O

  Scenario: Parameter without override retains default
    Given the default profile provides value D for parameter P
    And the configuration source provides no override for P
    When the configuration is resolved
    Then the resolved value for P must be D
```

## Resolution order

The resolved value of a policy parameter is determined by the following order, from highest precedence to lowest:

1. **Override from the configuration source** — if the configuration source provides a value for the parameter, that value is used.
1. **Default profile** — if no override is provided, the default profile's value is used.

A parameter that has neither an override nor a default profile value is **unresolved**. An unresolved parameter must be rejected at resolution time, and the rejection must be reported. This is a conformance failure: every policy parameter must have a defined value, as defined in [Policy parameters](#policy-parameters).

- The resolution must validate each resolved value against the type established by the owning specification. A value that fails validation must be rejected and reported, and must not be provided to subsystems.
- The resolution must be performed once, at startup, as defined in [Static resolution](#static-resolution).

```gherkin
Feature: Resolution order
  Rule: Override takes precedence over the default profile; unresolved parameters are rejected

  Scenario: Override takes precedence over default
    Given the default profile provides D for P
    And the configuration source provides O for P
    When the configuration is resolved
    Then the resolved value must be O

  Scenario: Default used when no override
    Given the default profile provides D for P
    And the configuration source provides no value for P
    When the configuration is resolved
    Then the resolved value must be D

  Scenario: Unresolved parameter is rejected
    Given the domain specifications define parameter P
    And the default profile provides no value for P
    And the configuration source provides no value for P
    When the configuration is resolved
    Then P must be rejected as unresolved
    And the rejection must be reported

  Scenario: Invalid value is rejected
    Given a resolved value for P does not conform to P's type
    When the configuration is resolved
    Then the value must be rejected
    And the rejection must be reported
```

## Static resolution

Policy values are resolved once, at startup, and remain fixed for the session.

- The configuration source must be read at startup, the resolution order applied, and the resolved values provided to subsystems at construction time.
- Subsystems must not re-read the configuration source after construction. A subsystem receives its policy values once and retains them for its lifetime.
- Dynamic adjustment of policy values at runtime is out of scope. An implementation that requires runtime-adjustable policy values must establish that through the specification workflow; this specification governs static resolution only.

This keeps the configuration contract simple and the behaviour of subsystems predictable: a subsystem's policy values are fixed for the session, and there is no notification or invalidation contract.

```gherkin
Feature: Static resolution
  Rule: Policy values are resolved at startup and remain fixed for the session

  Scenario: Values resolved at startup
    Given the configuration source provides values for parameters P1 and P2
    When the system starts
    Then the configuration must be resolved once
    And the resolved values must be provided to subsystems at construction time

  Scenario: Subsystem retains values for its lifetime
    Given a subsystem has been constructed with resolved value V for P
    When the subsystem subsequently reads P
    Then it must receive V
    And the subsystem must not re-read the configuration source
```

## Relationship to domain specifications

Domain specifications own their policy parameters. This specification defines the cross-cutting contract that those parameters satisfy. Where a domain specification defines policy parameters, it must:

- define the parameters that must exist and their required properties (name, type, what they govern);
- require that the parameters have defined values, as defined in [Policy parameters](#policy-parameters);
- link to this specification for the configuration source, default profile, and resolution order contract.

The following domain specifications define policy parameters and are subject to this contract:

- [Constrained agent](./constrained-agent.spec.md#policy-parameters) — trigger probabilities, budget composition, tool call costs, overspend, and carryover parameters.
- [Content-first retrieval](./content-first-retrieval.spec.md#policy-parameters) — filterable properties, match semantics, text search mechanism, ranking function, default result limit, and default sort policy.
- [Usage and deployment](./usage-and-deployment.spec.md#cost-and-abuse-controls) — per-session spend caps, global rate limits (both tier-dependent), and session state persistence policies per access tier. These are resolved at startup from the split configuration (content repository + deployment environment), as defined in [Usage and deployment](./usage-and-deployment.spec.md#configuration).

Other specifications reference policy parameters without a dedicated table:

- [Agent safety](./agent-safety.spec.md#relationship-to-the-budget) — the cost of `safety_consult`, owned by the [Constrained agent](./constrained-agent.spec.md#policy-parameters) tool call costs parameter.
- [Service bus](./service-bus.spec.md#on-demand-activation) — the broker host-launch policy, which is a broker policy informed by service metadata, not a policy parameter governed by this specification.
- [Authoring tooling](./authoring-tooling.spec.md#slug-uniqueness) — slug collision resolution policy, which is an implementation detail of compilation rather than a runtime policy parameter.

A domain specification that introduces new policy parameters must link to this specification and satisfy this contract. This specification does not enumerate the parameters; it defines the rules they follow.

## Conformance

An implementation conforms to this specification when:

- every policy parameter defined by the domain specifications has a defined value at runtime, conforming to the type established by its owning specification;
- a policy value that does not conform to its parameter's type is rejected at resolution time and reported;
- a configuration source abstraction is provided, from which resolved policy values are read;
- the configuration source is read-only with respect to the subsystems that consume it;
- subsystems receive their policy values at construction time and do not re-read the configuration source;
- a system-wide default profile is provided, giving a value for every policy parameter defined by the domain specifications;
- overrides from the configuration source take precedence over the default profile, and parameters without overrides retain the default profile's value;
- a parameter that is neither overridden nor present in the default profile is rejected as unresolved and reported;
- policy values are resolved once at startup and remain fixed for the session;
- the domain specifications that define policy parameters link to this specification and satisfy this contract.
