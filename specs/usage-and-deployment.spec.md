# Usage and deployment

## Purpose and scope

This specification defines how Darkling is to be deployed: how the reusable Darkling software is assembled with project-specific content, Guide definition, and configuration to produce a runnable Darkling instance, and how that instance is deployed and operated.

It defines the developer-facing usage and deployment model of Darkling, including the conventions, defaults, configuration, and extension points through which an application author constructs an instance.

The supported deployment targets are:

- Vercel, as the supported hosted deployment target; and
- local Node.js, for local development and operation.

It governs:

- the structure and entry point of a Darkling instance;
- the application configuration API and its conventions and defaults;
- the composition of the Darkling runtime with project-specific Archive content and Guide definition;
- supported content sources and their publishing workflows;
- the build and packaging process for supported deployment targets;
- the runtime topology and external dependencies required by a deployed instance;
- deployment and operational configuration;
- persistence, access, and resource controls as they apply to a deployed instance.

It is explicitly out of scope for this specification to define the internal behaviour of the components being assembled or deployed; those behaviours are defined by their respective specifications.

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Design context

Darkling is an immersive, single-Visitor experience: a person (the Visitor) explores the Archive in the company of the Guide. The system is designed to minimise friction to entry — there is no conventional logon flow — while bounding LLM cost and abuse through tiered access and spend controls. The Guide is self-consciously an AI within the fiction, which gives the system diegetic flexibility to acknowledge its own computational nature (e.g. a "rest" framing when a spend cap is reached) without breaking immersion.

An application author assembles a Darkling instance by combining the reusable Darkling software — the runtime, the Guide's constrained-agent loop, the knowledge-base and retrieval services, the UI — with three project-specific inputs: the Archive content (the worldbuilding), the Guide definition (the Guide's personality and behaviour as it appears within that worldbuilding), and configuration (content-specific and operational). The result is a deployable instance: a static frontend and a serverless backend, operated against a persistent store and an LLM provider.

The deployment topology is a static frontend (served by the hosting platform) and a serverless backend (Hono) that proxies the LLM and owns content compilation and retrieval. The in-frontend placement of subsystems across Web Workers is defined by [Runtime](./runtime.spec.md) and [User interface](./ui.spec.md); this specification governs only the deployment-level topology — what runs on the frontend, what runs on the backend, and what external dependencies a deployed instance requires.

## Deployment targets

Darkling supports two deployment targets.

### Vercel (hosted)

Vercel is the supported hosted deployment target. A Vercel deployment consists of:

- a static frontend served by Vercel's static-asset layer, produced by the build process defined in [Build and packaging](#build-and-packaging);
- a serverless backend (Hono) deployed as Vercel Serverless Functions or Edge Functions, exposing the HTTP API defined in [Deployment shape](#deployment-shape);
- external dependencies provisioned as Vercel integrations or equivalent services: a persistent store (e.g. Upstash Redis), a secret store, and a usage tracking store, as defined in [Backend stores](#backend-stores);
- operational configuration provided via Vercel environment variables, as defined in [Application configuration API](#application-configuration-api).

The frontend and backend are served from the same Vercel project; routing between the static frontend and the backend API is managed by the platform.

### Local Node.js (development and operation)

Local Node.js is the supported target for local development and operation. A local deployment consists of:

- the frontend served by the Vite dev server (development) or as static files by a local static server (operation);
- the backend run as a local Node.js process (e.g. `hono`-compatible server), exposing the same HTTP API as the hosted target;
- external dependencies provisioned locally: a persistent store (e.g. a local Redis instance or an in-memory store), a secret store, and a usage tracking store;
- operational configuration provided via a local environment (e.g. `.env` file or process environment), as defined in [Application configuration API](#application-configuration-api).

A local deployment must exhibit the same observable behaviour as a hosted deployment. The only differences are the provisioning of external dependencies and the origin from which the frontend and backend are served. This requirement exists so that an application author can develop and test against the same assembly and configuration model used for hosted deployment.

```gherkin
Feature: Deployment targets
  Rule: Vercel (hosted) and local Node.js (development and operation); both exhibit the same observable behaviour

  Scenario: Vercel deployment
    Given a Darkling instance has been assembled and built
    When it is deployed to Vercel
    Then the frontend must be served as static assets
    And the backend must run as serverless functions
    And external dependencies must be provisioned via Vercel integrations or equivalents

  Scenario: Local Node.js deployment
    Given a Darkling instance has been assembled
    When it is run on local Node.js
    Then the frontend must be served by the Vite dev server or a local static server
    And the backend must run as a local Node.js process
    And external dependencies must be provisioned locally

  Scenario: Local matches hosted behaviour
    Given an instance deployed on Vercel and the same instance run on local Node.js
    When the same inputs are provided to both
    Then the observable behaviour must be the same
    And only the provisioning of external dependencies and the serving origin may differ
```

## Instance structure and entry point

A Darkling instance is an application assembled from the reusable Darkling software and project-specific inputs. It has two parts: a **frontend application** and a **backend application**.

### The frontend application

The frontend application is the application author's entry point for the frontend. It assembles:

- the Darkling UI ([User interface](./ui.spec.md)), mounted on the main thread;
- the Darkling runtime ([Runtime](./runtime.spec.md)), with its service broker and service host workers;
- the Guide agent service ([Constrained agent](./constrained-agent.spec.md)), registered with the runtime;
- the retrieval service ([Content-first retrieval](./content-first-retrieval.spec.md)), registered with the runtime, backed by HTTP-client providers that call the backend;
- the Guide definition (as defined in [Composition](#composition));
- the application configuration, resolved at startup as defined in [Application configuration API](#application-configuration-api).

The frontend application's entry point is where the runtime is constructed and started, services are registered, the UI is mounted, and the bootstrap sequence is initiated. The detailed bootstrap sequence is defined by [Runtime](./runtime.spec.md) and [User interface](./ui.spec.md); this specification requires that the frontend application provides an entry point that assembles these components and starts the instance.

### The backend application

The backend application is the application author's entry point for the backend. It assembles:

- the Hono HTTP server exposing the LLM proxy and the retrieval and compilation API, as defined in [Deployment shape](#deployment-shape);
- the LLM provider, selected by configuration as defined in [LLM provider abstraction](#llm-provider-abstraction);
- the content compiler, reading from a content source as defined in [Content sources and publishing workflows](#content-sources-and-publishing-workflows);
- the persistent, secret, and usage tracking store connections, as defined in [Backend stores](#backend-stores);
- the application configuration, resolved at startup as defined in [Application configuration API](#application-configuration-api).

The backend application's entry point is where the server is constructed, the provider and stores are connected, the configuration is resolved, and the HTTP API is mounted.

### Visitor-facing entry point

The Visitor-facing entry point is the frontend's served URL. A Visitor loads the frontend in a browser; the frontend bootstraps and the Visitor interacts with the Guide. There is no Visitor-facing backend entry point; the backend is reached only by the frontend over HTTP.

### Content webhook entry point

The backend exposes an HTTP endpoint that receives webhook notifications of content source changes, triggering recompilation as defined in [Content sources and publishing workflows](#content-sources-and-publishing-workflows).

```gherkin
Feature: Instance structure and entry point
  Rule: A Darkling instance has a frontend application and a backend application, each with an entry point assembling the reusable software with project-specific inputs

  Scenario: Frontend application assembles the runtime, UI, Guide, and retrieval
    Given an application author creates a frontend application
    When the instance is started
    Then the runtime must be constructed and started
    And the Guide agent service and retrieval service must be registered with the runtime
    And the UI must be mounted
    And the Guide definition and configuration must be provided

  Scenario: Backend application assembles the server, provider, stores, and compiler
    Given an application author creates a backend application
    When the instance is started
    Then the Hono server must be constructed
    And the LLM provider and store connections must be established
    And the content compiler must be configured against a content source
    And the configuration must be resolved

  Scenario: Visitor-facing entry point is the frontend URL
    Given a Darkling instance is deployed
    When a Visitor loads the frontend URL in a browser
    Then the frontend must bootstrap
    And the Visitor must interact with the Guide through the UI
```

## Composition

A Darkling instance is composed by combining the reusable Darkling software with three project-specific inputs: Archive content, the Guide definition, and configuration.

### Archive content

The Archive content is the project-specific worldbuilding: the documents, content blocks, relationships, and annotations that make up the fictional setting. It is authored as semantically enriched Markdown in a content source, as defined in [Content sources and publishing workflows](#content-sources-and-publishing-workflows), and compiled into the content model defined by [Content model](./content-model.spec.md) and [Authoring tooling](./authoring-tooling.spec.md). The compiled content model is stored in the persistent store and retrieved by the Guide and the UI at runtime.

The content is distinct from the software: the application codebase is reusable, while the content is project-specific and versioned independently in its own source.

### Guide definition

The **Guide definition** is the project-specific definition of the Guide as it appears within the assembled instance: the Guide's personality, voice, and in-fiction behaviour, as distinct from the constrained-agent mechanics that govern how the Guide operates as an LLM-based actor (which are defined by [Constrained agent](./constrained-agent.spec.md)).

The Guide definition is an assembly input: the application author provides it when composing the instance, and the backend composes it into the prompt at runtime. It shapes the Guide's responses — how the Guide speaks, what it knows about itself and the world, how it presents its nature as an AI within the fiction — without altering the agentic model (the event queue, flush policy, budget, tool discipline, and FINISHED behaviour).

#### Relationship to annotations and the constrained-agent framing

The Guide's prompt is composed from three sources, each owned separately:

- the **constrained-agent framing** — the system message rendering the status object (budget, working memory, undispatched tool calls) and the tool-call discipline (no free text; issue tool calls or FINISHED) — owned by the LLM provider, as defined by [Constrained agent](./constrained-agent.spec.md) and the `@darkling/guide` provider;
- the **Guide definition** — the Guide's personality, voice, self-conception, and safety posture — owned by this specification and supplied as an assembly input;
- **annotations** — the Guide's authored subjective perspective (opinions, affective cues, private recollections) on Archive content — owned by [Annotations](./annotations.spec.md), authored in the content source's frontmatter, and retrieved at runtime.

The Guide definition is distinct from annotations: annotations are topic-linked notes on specific Archive content, retrieved through the retrieval interface; the Guide definition is the Guide's standing personality and behavioural definition, applied to every interaction regardless of what content is in view. The backend composes the full prompt from all three sources: the constrained-agent framing, the Guide definition, and the annotations relevant to the current interaction.

#### Structure

The Guide definition is a **hybrid**: a structured object combining typed fields with a free-form personality section. An instance must provide a Guide definition with the following parts:

- **Voice** — a free-form text section defining the Guide's personality, manner, and voice. This is the prose personality of the Guide: how it speaks, its temperament, its self-conception as an AI within the fiction. The backend renders this into the prompt as the Guide's character description.
- **Greeting** — optional typed field(s) defining how the Guide may greet a Visitor on session start (e.g. a greeting template or a set of candidate greetings). The Guide may greet the Visitor or decline to act, as permitted by [Constrained agent](./constrained-agent.spec.md#finished); the greeting field shapes the greeting when it occurs.
- **Safety posture** — a typed field defining the Guide's safety disposition (e.g. encouragement to consult the safety consultant, or cautionary framing). This supplements the constrained-agent `safety_consult` tool, as defined by [Agent safety](./agent-safety.spec.md), with personality-level safety guidance.

The specific field names and their rendering into the prompt are implementation concerns of the backend's prompt construction; this specification requires that the Guide definition has a voice section and may have greeting and safety-posture fields, and that the backend renders them into the prompt alongside the constrained-agent framing and annotations.

#### Location

The Guide definition lives in the **content repository**, alongside the source Markdown and the content-specific configuration file. It is versioned with the worldbuilding, like content-specific configuration, because it is part of the fictional setting: the Guide's personality is authored alongside the world it inhabits. The backend reads the Guide definition when it clones or pulls the content repository, at the same time as it reads the source Markdown and the content-specific configuration, as defined in [Content sources and publishing workflows](#content-sources-and-publishing-workflows).

Where the Guide definition references content (e.g. the Guide's knowledge of the world), it does so through the same compiled content model and retrieval interface as the rest of the system; the Guide definition itself does not embed content, it defines the Guide's stance toward it.

```gherkin
Feature: Guide definition
  Rule: A hybrid assembly input (voice + greeting + safety posture) composed into the prompt alongside the constrained-agent framing and annotations; lives in the content repository

  Scenario: Guide definition is provided as an assembly input
    Given an application author assembles an instance with a Guide definition
    When the backend composes a prompt for an interaction
    Then the prompt must include the Guide definition's voice section
    And the agentic model (event queue, flush, budget, tools, FINISHED) must not be altered

  Scenario: Guide definition is distinct from annotations
    Given an interaction is in progress
    When the backend composes the prompt
    Then the prompt must include the Guide definition (the standing personality)
    And the prompt may include annotations relevant to the current content
    And the Guide definition must not embed annotations

  Scenario: Guide definition lives in the content repository
    Given the content repository contains a Guide definition
    When the backend clones or pulls the repository
    Then the backend must read the Guide definition alongside the source Markdown and content-specific configuration
    And the Guide definition must be versioned with the content

  Scenario: Guide definition is composed with the constrained-agent framing
    Given an interaction is triggered
    When the backend composes the prompt
    Then the prompt must include the constrained-agent framing (status object, tool discipline)
    And the prompt must include the Guide definition
    And the prompt may include annotations
```

### Configuration

Configuration is the third assembly input, governing how the assembled instance operates. It is defined in [Application configuration API](#application-configuration-api).

### Composition boundary

The composition boundary is the set of interfaces through which the project-specific inputs are supplied to the reusable software:

- the content source interface, through which the content compiler reads the Archive content;
- the Guide definition, supplied to the Guide agent service;
- the configuration, supplied to the frontend and backend applications at startup.

The reusable software does not depend on the specific content, Guide definition, or configuration of any particular instance. An application author composes an instance by providing these three inputs through the composition boundary; the reusable software provides the entry points, service declarations, and configuration API that accept them.

```gherkin
Feature: Composition
  Rule: An instance is composed from reusable software with Archive content, a Guide definition, and configuration

  Scenario: Archive content is project-specific
    Given an application author assembles an instance
    When the content source is provided
    Then the compiler must read the Archive content from it
    And the compiled model must be stored in the persistent store

  Scenario: Guide definition shapes the Guide without altering the agentic model
    Given an application author provides a Guide definition
    When the Guide agent service is constructed
    Then the Guide definition must be supplied to it
    And the agentic model (event queue, flush, budget, tools, FINISHED) must not be altered

  Scenario: Reusable software does not depend on specific inputs
    Given the reusable Darkling software
    When it is assembled with any valid content, Guide definition, and configuration
    Then it must operate without modification to the software itself
```

## Application configuration API

This specification owns the configuration model for a Darkling instance: the developer-facing configuration API through which an application author provides configuration, its conventions and defaults, the sources from which configuration is read, and the resolution of configuration values at startup.

The cross-cutting structural contract for policy parameters — what a policy parameter is, and the structural requirements every policy parameter must satisfy (existence, defined value, type, documentation) — is defined by [Policy and configuration](./policy-and-configuration.spec.md). This specification defines how configuration is provided to a Darkling instance and resolved for its subsystems: the configuration source, the default profile, the resolution order, and static resolution at startup. The policy parameters themselves are governed by that specification and the domain specifications that own them.

### Configuration source

Policy values are read from a **configuration source**: an abstraction from which the resolved values of policy parameters are obtained. The configuration source is platform-neutral; the specific source is an implementation concern.

- The configuration source must provide a value for every policy parameter defined by the domain specifications, after applying the resolution order defined in [Resolution order](#resolution-order).
- The configuration source must reject values that do not conform to the type of their parameter, as defined by the owning specification, and report the rejection.
- The configuration source must be read-only with respect to the subsystems that consume it: subsystems read values from the source but must not alter it.
- The specific configuration source implementation is an implementation concern. An implementation may provide a source backed by environment variables, a configuration file, a remote configuration service, an in-memory object, or any combination. The abstraction keeps the system platform-neutral and testable, mirroring the `ContentSource` pattern used by the compiler, as defined by [Authoring tooling](./authoring-tooling.spec.md).

For a Darkling instance, the configuration source reads from the two configuration sources defined in [Configuration sources](#configuration-sources): the content repository's config file and the deployment environment. The backend resolves configuration from both at startup; the frontend receives its configuration at bootstrap.

#### Provision to subsystems

Subsystems obtain their policy values from the configuration source at construction time. Each subsystem declares the policy parameters it reads; the configuration source provides the resolved values for those parameters. This keeps subsystems decoupled from the configuration source's implementation and from parameters they do not consume.

- A subsystem must not read a policy parameter that its owning specification has not defined.
- A subsystem must receive its policy values at construction time, as defined in [Static resolution](#static-resolution).

### Configuration sources

Configuration is split between two sources, each holding the kind of configuration most relevant to it.

#### Content-specific configuration (in the content repository)

A configuration file lives in the root of the content repository, alongside the source Markdown. It holds configuration that is part of the worldbuilding and versioned with the content:

- content-specific policy (e.g. the relationship-type vocabulary, if configurable beyond the default, and document metadata policies);
- any content-specific retrieval policy parameters (e.g. filterable properties, if extended beyond the default schema).

The backend reads this file when it clones or pulls the content repository, at the same time as it reads the source Markdown. Content-specific configuration is thus versioned with the content it governs.

#### Operational configuration (in the deployment environment)

The deployment environment holds configuration that is operational rather than worldbuilding. These are provided as environment variables (or the platform's equivalent):

- the content repository URL;
- the LLM API key and provider selection;
- the persistent, secret, and usage tracking store connections;
- the spend caps and rate limits per access tier;
- the session state persistence policy per access tier.

Pre-shared secrets and their rights are held in the secret store, as defined in [Secret store](#secret-store), not in the deployment environment.

The deployment is minimal: a couple of environment variables link it to the content repository and the LLM provider; everything else is either in the content repository's config file or in the deployment environment.

### Configuration API

The application configuration API is the developer-facing interface through which an application author provides configuration to an instance. It provides a typed configuration object, constructed at the frontend and backend entry points from the resolved configuration sources, and provided to subsystems at construction time.

#### Entry-point construction

The application author constructs the configuration object at the frontend and backend entry points (as defined in [Instance structure and entry point](#instance-structure-and-entry-point)):

1. the configuration source reads from the two configuration sources (the content repository's config file and the deployment environment), as defined in [Configuration sources](#configuration-sources);
2. the default profile provides a value for every policy parameter, as defined in [Default profile](#default-profile);
3. the resolution order applies (override over default), as defined in [Resolution order](#resolution-order);
4. the resolved values are validated against the types established by their owning specifications;
5. the resulting typed configuration object is passed to the runtime and subsystems at construction time.

The application author does not hand-write every value: the configuration object is constructed by resolving the sources against the default profile. The author's role is to provide the sources (the content repository, the deployment environment) and, where needed, overrides; the API and the default profile fill in the rest.

#### Top-level structure

The configuration object is organised into sections grouping configuration by concern. This specification defines the sections; the specific policy parameters within each subsystem section are defined by the owning domain specification's policy-parameter table, which this API references rather than duplicating.

- **`content`** — the content source location and content-specific configuration, read from the content repository: the content repository URL (operational, from the deployment environment) and the content-specific configuration file's values (e.g. relationship-type vocabulary, document metadata policies, content-specific retrieval policy), as defined in [Content-specific configuration](#content-specific-configuration-in-the-content-repository).
- **`llm`** — the LLM provider selection and API key, read from the deployment environment, as defined in [LLM provider abstraction](#llm-provider-abstraction). The API key is held by the backend and must not appear in the frontend's configuration object.
- **`stores`** — the persistent, secret, and usage tracking store connections, read from the deployment environment, as defined in [Backend stores](#backend-stores).
- **`access`** — the per-tier access configuration: spend caps and rate limits per access tier, and the session state persistence policy per access tier, read from the deployment environment, as defined in [Cost and abuse controls](#cost-and-abuse-controls) and [Session model](#session-model).
- **`guide`** — the Guide's constrained-agent policy parameters (trigger probabilities, budget composition, tool call costs, overspend, carryover), as defined by [Constrained agent](./constrained-agent.spec.md#policy-parameters). Values are resolved from the content-specific and operational sources over the default profile.
- **`retrieval`** — the retrieval policy parameters (filterable properties, match semantics, text search mechanism, ranking function, default result limit, default sort policy), as defined by [Content-first retrieval](./content-first-retrieval.spec.md#policy-parameters). Content-specific retrieval policy is read from the content repository; the remainder from the default profile and operational overrides.
- **`runtime`** — the runtime policy parameters (e.g. broadcast channel name), as defined by [Runtime](./runtime.spec.md#policy-parameters).

The frontend and backend entry points receive the sections relevant to them: the backend receives all sections (it owns the LLM proxy, stores, content compilation, and access controls); the frontend receives the sections its subsystems consume (e.g. `guide`, `retrieval`, `runtime`, and the content version for cache invalidation), with secrets and backend-only sections excluded.

#### Conventions and defaults

Where a configuration value is not provided by either source, the default profile supplies a value, as defined in [Default profile](#default-profile). The system applies a defined default rather than failing, where the governing specification permits a default. A parameter that is neither overridden nor present in the default profile is rejected as unresolved, as defined in [Resolution order](#resolution-order).

#### Validation

Configuration values must conform to the type of their parameter, as established by the owning specification. Invalid values must be rejected and reported at resolution time, as defined in [Resolution order](#resolution-order), and must not be provided to subsystems.

#### Provision to subsystems

Subsystems receive their configuration values at construction time, as defined in [Provision to subsystems](#provision-to-subsystems). Each subsystem declares the policy parameters it reads; the configuration object provides the resolved values for those parameters. Subsystems must not re-read the configuration source after construction, as defined in [Static resolution](#static-resolution).

The specific field names, types, and defaults within each section are implementation concerns defined by the owning specifications' policy-parameter tables; this specification defines the section structure, the entry-point construction model, the conventions and defaults, and the provision to subsystems.

### Configuration caching

The backend caches resolved non-secret configuration in the persistent store, as defined in [Persistent store](#persistent-store-content-and-configuration-cache), so that subsequent serverless invocations do not need to re-read the content repository or re-resolve the environment. The cache is updated on recompilation (for content-specific config) and on deployment change (for operational config). Secrets are not cached; they are held in the secret store.

### Default profile

A **default profile** is a named, system-wide default configuration that provides a value for every policy parameter defined by the domain specifications. The default profile is the baseline against which overrides are applied.

- The system must provide a default profile. The default profile must provide a value for every policy parameter defined by the domain specifications; it must not leave any parameter undefined.
- The default profile must be documented. The documentation must identify the profile by name and state that it is the system default.
- The default profile's values must conform to the types established by the owning specifications.
- The specific values of the default profile are implementation-defined. This specification requires that a default profile exists and is complete; it does not prescribe the values.

A configuration source may provide values that override the default profile. When an override is provided for a parameter, the override's value takes precedence over the default profile's value, subject to the resolution order.

- An override must conform to the type of the parameter it overrides; an invalid override must be rejected and reported, as defined in [Configuration source](#configuration-source).
- An override may be provided for some parameters and not others; parameters without an override retain the default profile's value.

### Resolution order

The resolved value of a policy parameter is determined by the following order, from highest precedence to lowest:

1. **Override from the configuration source** — if the configuration source provides a value for the parameter, that value is used.
2. **Default profile** — if no override is provided, the default profile's value is used.

A parameter that has neither an override nor a default profile value is **unresolved**. An unresolved parameter must be rejected at resolution time, and the rejection must be reported. This is a conformance failure: every policy parameter must have a defined value, as defined by [Policy and configuration](./policy-and-configuration.spec.md#policy-parameters).

- The resolution must validate each resolved value against the type established by the owning specification. A value that fails validation must be rejected and reported, and must not be provided to subsystems.
- The resolution must be performed once, at startup, as defined in [Static resolution](#static-resolution).

### Static resolution

Policy values are resolved once, at startup, and remain fixed for the session.

- The configuration source must be read at startup, the resolution order applied, and the resolved values provided to subsystems at construction time.
- Subsystems must not re-read the configuration source after construction. A subsystem receives its policy values once and retains them for its lifetime.
- Dynamic adjustment of policy values at runtime is out of scope. An implementation that requires runtime-adjustable policy values must establish that through the specification workflow; this specification governs static resolution only.

This keeps the configuration contract simple and the behaviour of subsystems predictable: a subsystem's policy values are fixed for the session, and there is no notification or invalidation contract.

### Resolution at startup

Both kinds of configuration are resolved at startup. The backend reads the content repository's config file and the deployment environment's variables when it initialises; the frontend receives its configuration at bootstrap. Policy values must have defined values, as defined by [Policy and configuration](./policy-and-configuration.spec.md#policy-parameters), and are resolved statically at startup, as defined in [Static resolution](#static-resolution).

```gherkin
Feature: Application configuration API
  Rule: Configuration from the content repo and deployment environment; resolved at startup; defaults applied; provided to subsystems at construction time

  Scenario: Content config is versioned with content
    Given the content repository contains a config file
    When the backend clones or pulls the repository
    Then the backend must read the config file alongside the source Markdown
    And the config must be versioned with the content

  Scenario: Operational config is in the deployment environment
    Given the deployment environment provides the content repo URL and LLM API key
    When the backend initialises
    Then the backend must read the operational config from the environment
    And the deployment must not require the content repo to hold operational config

  Scenario: Defaults applied where not provided
    Given a configuration value is not provided
    When the configuration is resolved
    Then the system must apply a defined default
    And the subsystem must receive the default value

  Scenario: Invalid configuration rejected
    Given a configuration value does not conform to its parameter's type
    When the configuration is resolved
    Then the value must be rejected
    And the rejection must be reported

  Scenario: Both resolved at startup
    Given content config and operational config are available
    When the system starts
    Then all configuration values must be resolved and have defined values
    And subsystems must receive their values at construction time

  Scenario: Config object is constructed at the entry points
    Given the content repository and deployment environment are available
    When the frontend and backend entry points construct the configuration
    Then the configuration source must read from both sources
    And the default profile must supply values for parameters not overridden
    And the resolved values must be validated against their owning specifications' types
    And the resulting typed configuration object must be passed to subsystems at construction time

  Scenario: Frontend excludes backend-only sections and secrets
    Given the configuration object has been constructed
    When the frontend entry point receives its configuration
    Then the frontend must receive the sections its subsystems consume
    And the frontend must not receive the LLM API key or backend-only sections

  Scenario: Config object is organised into sections by concern
    Given the configuration object has been constructed
    Then it must have a content section, an llm section, a stores section, an access section, a guide section, a retrieval section, and a runtime section
    And the policy parameters within each subsystem section must be those defined by the owning domain specification
```

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

## Content sources and publishing workflows

Archive content is authored as semantically enriched Markdown in a content source, separate from the application codebase, as defined by [Authoring tooling](./authoring-tooling.spec.md#content-sources). This specification governs the supported content sources and the publishing workflows by which content changes reach a deployed instance.

### Supported content source: external git repository

The supported content source is an external git repository containing the source Markdown and the content-specific configuration file. The backend is the only component that accesses the content repository; the frontend never does.

### Publishing workflow: webhook-triggered recompilation

Content changes are published to a deployed instance via webhook-triggered recompilation:

1. The content source changes (the author commits and pushes to the git repository).
2. A webhook notifies the backend that the content source has changed, as defined by [Authoring tooling](./authoring-tooling.spec.md#recompilation-trigger).
3. The backend recompiles the affected source into the compiled content model, conforming to the [compilation contract](./content-model.spec.md#compilation-contract), and writes the result to the persistent store.
4. The frontend's cached entries are invalidated via the cache invalidation mechanism, as defined by [Content-first retrieval](./content-first-retrieval.spec.md).

The specific webhook payload format and the mapping from webhook to affected files is an implementation concern. The compiled model is not shipped as a static asset; it lives in the persistent store and is queried at runtime.

```gherkin
Feature: Content sources and publishing workflows
  Rule: Source in an external git repo; published to a deployed instance via webhook-triggered recompilation

  Scenario: Source in external git repo
    Given the content source is a git repository
    Then the backend must be the only component that accesses it
    And the frontend must not access the git repository

  Scenario: Webhook triggers recompilation
    Given the content source has changed
    When the backend receives a webhook
    Then the backend must recompile the affected source
    And the backend must update the persistent store with the compiled model

  Scenario: Compiled model served from the persistent store
    Given the compiled model is in the persistent store
    When the frontend requests retrieval
    Then the backend must query the persistent store
    And the compiled model must not be shipped as a static asset
```

## Build and packaging

A Darkling instance is built and packaged for its deployment target.

### Frontend build

The frontend is built by Vite, producing a static build (HTML, JavaScript, CSS, and other static assets) served by the hosting platform's static-asset layer. The build:

- bundles the frontend application and the reusable Darkling frontend software (the runtime, Guide agent service, retrieval service, and UI);
- produces the service host worker entry points as separate chunks, as required by [Runtime](./runtime.spec.md);
- produces the Service Worker for transparent token handling, as defined in [Access and authentication](#access-and-authentication);
- embeds the content version (for cache invalidation) and any frontend-resolved configuration, as defined in [Application configuration API](#application-configuration-api).

### Backend packaging

The backend is packaged as a serverless application (Hono) for the deployment target:

- on Vercel, as Serverless Functions or Edge Functions, with the HTTP API mounted at the platform's route prefix;
- on local Node.js, as a runnable Node process with the HTTP API mounted on a local port.

The backend packaging bundles the backend application and the reusable Darkling backend software (the Hono server, LLM provider, content compiler, and store connections). The backend does not bundle the compiled content model; it reads it from the persistent store at runtime.

### Target-specific build configuration

The build is configured for the deployment target:

- on Vercel, the build is configured via the project's Vercel configuration (e.g. `vercel.json`), with the frontend as static assets and the backend as serverless functions;
- on local Node.js, the build is configured via the Vite configuration for the frontend and the backend's own entry point for the backend.

The specific build configuration is an implementation concern; this specification requires that the build produces a deployable frontend and backend for the chosen target, and that the same application codebase builds for both targets.

```gherkin
Feature: Build and packaging
  Rule: The frontend is a Vite static build; the backend is a packaged serverless application; both build for Vercel and local Node.js

  Scenario: Frontend build produces static assets
    Given the frontend application and reusable frontend software
    When the frontend is built by Vite
    Then the build must produce static assets
    And the build must produce service host worker entry points as separate chunks
    And the build must produce the Service Worker

  Scenario: Backend packaging produces a serverless application
    Given the backend application and reusable backend software
    When the backend is packaged
    Then it must be packaged as a serverless application for the chosen target

  Scenario: Same codebase builds for both targets
    Given the Darkling instance application codebase
    When it is built for Vercel and for local Node.js
    Then both builds must succeed
    And the same application code must produce both deployments
```

## Deployment shape

A Darkling instance is deployed as two components: a frontend and a backend.

- **Frontend** — a static build (produced by Vite, as defined in [Build and packaging](#build-and-packaging)) served by the hosting platform's static-asset layer. The frontend is a single-page application that runs the UI, the Guide, and client-side services. The in-frontend placement of subsystems across Web Workers is defined by [Runtime](./runtime.spec.md) and [User interface](./ui.spec.md).
- **Backend** — a serverless application (Hono) exposing an HTTP API. The backend is stateless per-invocation: it holds no in-memory session or compiled-model state between requests. It is backed by external stores, as defined in [Backend stores](#backend-stores).

The frontend static build and the backend API may be served from the same origin or from a platform-managed routing layer; the specific arrangement is a deployment concern. The frontend calls the backend over HTTP.

### Backend responsibilities

The backend has two responsibilities: proxying the LLM and owning the content model.

#### LLM proxy

The backend proxies LLM calls from the frontend to the LLM provider. The backend holds the LLM API key; the frontend never does. The backend applies the cost and abuse controls defined in [Cost and abuse controls](#cost-and-abuse-controls) before forwarding. The LLM provider is abstracted behind a provider interface, as defined in [LLM provider abstraction](#llm-provider-abstraction).

#### Content compilation and retrieval

The backend owns the compiled content model: it compiles source material into the persistent store and serves retrieval queries from it.

- **Compilation.** The backend reads source Markdown from the content source, compiles it into the compiled content model (as defined by [Authoring tooling](./authoring-tooling.spec.md) and [Content model](./content-model.spec.md)), and writes the result to the persistent store. Compilation is triggered on webhook, as defined in [Content sources and publishing workflows](#content-sources-and-publishing-workflows).
- **Retrieval.** The backend serves retrieval queries over HTTP, reading from the persistent store. The retrieval interface conforms to [Content-first retrieval](./content-first-retrieval.spec.md); the backend's persistent store provides the block store, property index, text index, relationship index, and containment index defined there. The per-index provider interfaces established by `@darkling/knowledge-base` are the abstraction boundary: the backend implements them against the persistent store; the frontend implements them as HTTP-client backends that call the backend.

```gherkin
Feature: Deployment shape
  Rule: A static frontend and a serverless backend with external stores

  Scenario: Frontend is a static build
    Given the frontend has been built by Vite
    When it is deployed
    Then it must be served as static assets by the hosting platform

  Scenario: Backend is serverless and stateless
    Given the backend is a Hono serverless application
    When a request arrives
    Then the backend must not rely on in-memory state from a previous request
    And the backend must read the compiled model from the persistent store

  Scenario: LLM call is proxied
    Given the Guide agent loop on the frontend needs an LLM response
    When it calls the backend
    Then the backend must forward the request to the configured LLM provider
    And the backend must hold the API key, not the frontend

  Scenario: Retrieval serves from the persistent store
    Given the compiled model is stored in the persistent store
    When the frontend requests a retrieval query
    Then the backend must query the persistent store
    And the backend must return the result over HTTP
```

## Runtime topology and external dependencies

This specification governs the deployment-level topology of a Darkling instance: what runs on the frontend, what runs on the backend, and the external dependencies a deployed instance requires. The in-frontend placement of subsystems across the main thread and Web Workers is defined by [Runtime](./runtime.spec.md) and [User interface](./ui.spec.md).

### Deployment-level topology

- The frontend runs the UI, the Guide's constrained-agent loop, and the retrieval service. These are placed across the main thread and Web Workers as defined by [Runtime](./runtime.spec.md); the Guide agent loop runs in a dedicated worker, and the UI runs on the main thread.
- A Service Worker runs in the browser for transparent token handling, as defined in [Access and authentication](#access-and-authentication).
- The backend runs the LLM proxy and the content compilation and retrieval services, as defined in [Deployment shape](#deployment-shape).
- The backend is not on the frontend runtime; the frontend reaches the backend over HTTP.

### External dependencies

A deployed instance requires the following external dependencies, provisioned per deployment target as defined in [Deployment targets](#deployment-targets):

- an **LLM provider** (e.g. OpenAI, Anthropic, a local model), selected by configuration as defined in [LLM provider abstraction](#llm-provider-abstraction);
- a **persistent store** (e.g. Upstash Redis) for the compiled content model and non-secret configuration cache;
- a **secret store** for pre-shared secrets, as defined in [Secret store](#secret-store);
- a **usage tracking store** for per-session spend and global rate-limit counters, as defined in [Usage tracking store](#usage-tracking-store).

The specific store technologies are implementation concerns; this specification requires that the external dependencies exist and that the backend can connect to them.

## LLM provider abstraction

The backend abstracts the LLM behind a provider interface. The specific provider (e.g. OpenAI, Anthropic, a local model) is a configuration choice, not baked into the system.

- The backend must expose a uniform interface for LLM invocation regardless of the underlying provider.
- The provider is selected by configuration, as defined in [Application configuration API](#application-configuration-api). Changing the provider must not require changing the constrained-agent specification or the frontend.
- The API key for the selected provider is held by the backend; it must not be sent to the frontend.
- The provider interface must accommodate the constrained agent's interaction model: the backend receives the prompt/status input (event queue, budget, working memory, undispatched tool calls) and returns the model's response (tool calls and FINISHED signal), as defined by [Constrained agent](./constrained-agent.spec.md).

```gherkin
Feature: LLM provider abstraction
  Rule: The LLM is behind a provider interface; the provider is a configuration choice

  Scenario: Provider is swappable
    Given the backend is configured with provider A
    When the configuration is changed to provider B
    Then the backend must invoke provider B
    And the constrained agent specification and frontend must not change

  Scenario: API key stays on the backend
    Given the backend holds the API key for the configured provider
    When the frontend calls the backend to invoke the LLM
    Then the API key must not be sent to the frontend
```

## Access and authentication

Darkling has no accounts and no logon flow. Access is governed by a secret-for-token exchange: pre-shared secrets (issued out of band) carry predetermined rights; the backend exchanges a presented secret for a signed token (PASETO or JWT) with those rights as claims. The token's claims determine the Visitor's access tier and the cost and abuse controls applied, as defined in [Cost and abuse controls](#cost-and-abuse-controls).

### Pre-shared secrets

A **pre-shared secret** is an out-of-band-issued credential that carries predetermined rights (the access tier and any associated caps or limits). Secrets are issued by the operator and shared via a link or other out-of-band channel.

- Secrets are held in the secret store, as defined in [Secret store](#secret-store).
- A secret is presented to the backend, which validates it against the secret store and issues a signed token with the secret's rights as claims.
- Secrets are single-use for exchange: presenting a secret yields a token; the secret is not subsequently needed.
- The specific secret format and issuance mechanism is an implementation concern; this specification requires that the exchange mechanism exists.

### Token issuance and tiers

The backend issues a signed token (PASETO or JWT) to every Visitor. The token carries an access-tier claim. There are three tiers:

- **Anonymous** — the default. A Visitor who arrives with no secret is issued an anonymous token automatically. Anonymous Visitors are subject to lower per-session spend caps and lower global rate limits.
- **Token** — a Visitor who presents a valid pre-shared secret with token rights is issued a token-tier token. Token-holders are subject to higher per-session spend caps and higher global rate limits.
- **Operator** — a Visitor who presents a pre-shared secret with operator rights is issued an operator-tier token. The operator tier has no spend cap and no rate limit.

No tier requires a logon flow, credentials, or per-Visitor identity tracking. The tier is a claim inside the token, not a property of who the Visitor is.

### Token handling

A Service Worker manages the token lifecycle transparently, so that application code is unaware of tokens. The Service Worker's lifecycle mechanics — activation, token exchange, attachment to backend requests, refresh, expiry, and token isolation — are defined by [User interface](./ui.spec.md#service-worker). This specification requires that a Service Worker performs transparent token handling and that application code is unaware of tokens. The backend validates the token on each request and applies the tier's caps and limits. The frontend's application code is unaware of the tier except to display in-world messaging when a cap is reached, as defined in [Cap enforcement](#cap-enforcement).

```gherkin
Feature: Access and authentication
  Rule: Pre-shared secrets exchanged for signed tokens; anonymous tokens issued automatically; no logon UI; Service Worker handles tokens transparently

  Scenario: Anonymous Visitor gets a token automatically
    Given a Visitor reaches the frontend with no secret
    When the Service Worker requests a token
    Then the backend must issue an anonymous-tier token
    And no logon UI must be shown

  Scenario: Secret exchanged for a token
    Given a Visitor presents a valid pre-shared secret with token rights
    When the Service Worker exchanges the secret
    Then the backend must issue a token-tier token carrying the rights as claims
    And no logon UI must be shown

  Scenario: Service Worker attaches the token transparently
    Given the Service Worker holds a valid token
    When the frontend makes a fetch request to the backend
    Then the Service Worker must attach the Authorization header
    And the application code must not handle the token

  Scenario: Operator secret yields an operator token
    Given a Visitor presents a pre-shared secret with operator rights
    When the Service Worker exchanges the secret
    Then the backend must issue an operator-tier token
    And the backend must apply no spend cap and no rate limit
```

## Session model

A **session** is a single browser visit: from page load to the page being closed or reloaded.

- Session state — the event queue, budget carryover, and the Guide's interaction input — lives in the browser for the visit.
- Whether session state persists across visits is configurable per access tier. A tier whose persistence policy is **persistent** retains session state across visits for the same browser; a tier whose policy is **ephemeral** discards session state at the end of each visit. The persistence policy is a property of the tier, determined by the token's claims and the configuration, as defined in [Application configuration API](#application-configuration-api).
- The backend does not store per-session Guide state. The backend tracks spend and rate-limit counters for the duration of a session, keyed by a session identifier derived from the token; these counters are discarded when the session ends.
- Session state is per-browser, not per-account: there are no accounts, so the browser is the scope of persistence. Clearing site data resets persisted state regardless of tier.

The mechanism by which session state persistence is realised — what persists, how it is stored, and the carryover shape — is defined by [Constrained agent](./constrained-agent.spec.md#persistence-and-scope). This specification establishes the deployment-level policy that persistence is configurable per access tier and that persistent tiers resume prior state on return visits.

```gherkin
Feature: Session model
  Rule: A session is a browser visit; persistence is configurable per access tier

  Scenario: Persistent tier survives a visit
    Given a Visitor in a persistent tier has working memory W at the end of a visit
    When the Visitor returns in the same browser
    Then the Guide must resume with working memory W

  Scenario: Ephemeral tier resets each visit
    Given a Visitor in an ephemeral tier has working memory W at the end of a visit
    When the Visitor returns in the same browser
    Then the Guide must start fresh, without W

  Scenario: Clearing site data resets persisted state
    Given a Visitor in a persistent tier has working memory W
    When the Visitor clears site data
    Then the Guide must start fresh on the next visit
```

## Cost and abuse controls

LLM cost and abuse are bounded by two mechanisms, applied per the Visitor's access tier:

- **Per-session spend cap.** The backend enforces a hard cap on LLM spend per session. When the cap is reached, the Guide stops responding, as defined in [Cap enforcement](#cap-enforcement). The cap value is tier-dependent: anonymous (low), token (higher), operator (none).
- **Global rate limit.** The backend enforces a global rate limit on LLM calls across all sessions, preventing aggregate cost runaway regardless of Visitor count. The rate limit value is tier-dependent: anonymous (low), token (higher), operator (none).

The cap and rate-limit values are configuration values, resolved at startup as defined in [Application configuration API](#application-configuration-api). They must have defined values for each tier, as defined by [Policy and configuration](./policy-and-configuration.spec.md#policy-parameters). The backend tracks usage against these caps and limits in the usage tracking store, as defined in [Usage tracking store](#usage-tracking-store).

### Cap enforcement

When a Visitor's per-session spend cap is reached, the Guide must stop incurring LLM cost. The enforcement is diegetic: the Guide is self-consciously an AI within the fiction, so the cap is presented in-world rather than as a system error.

- When the cap is reached, the backend must refuse further LLM calls for that session.
- The frontend must present an in-world "rest" message — the Guide indicates it needs to rest or is otherwise unavailable — rather than a system error or a fourth-wall-breaking limit notification.
- The Guide must not dispatch further tool calls or produce free text after the cap is reached; the interaction ends as if the Guide returned FINISHED without dispatching, as defined by [Constrained agent](./constrained-agent.spec.md#finished).
- The cap resets when the session resets (page reload or close).

```gherkin
Feature: Cost and abuse controls
  Rule: Per-session spend cap and global rate limit, tier-dependent; cap hit is diegetic

  Scenario: Per-session spend cap reached
    Given an anonymous Visitor has incurred LLM spend up to the anonymous cap
    When the Guide attempts another interaction
    Then the backend must refuse the LLM call
    And the frontend must present an in-world rest message
    And the Guide must not dispatch further tool calls

  Scenario: Cap is tier-dependent
    Given an anonymous Visitor has a low spend cap
    And a token-holding Visitor has a higher spend cap
    When both incur the same spend
    Then the anonymous Visitor may reach the cap
    And the token-holding Visitor may not

  Scenario: Global rate limit reached
    Given the global rate limit has been reached for the anonymous tier
    When an anonymous Visitor attempts an LLM call
    Then the backend must refuse the call
```

## Backend stores

The backend is stateless per-invocation, so the state it requires between requests is held in stores. The backend uses three logical stores, which may be backed by the same or different physical stores. These are external dependencies of a deployed instance, as defined in [Runtime topology and external dependencies](#runtime-topology-and-external-dependencies).

### Persistent store (content and configuration cache)

The persistent store (e.g. Upstash/Redis) holds the compiled content model. It also holds a cache of non-secret configuration, as defined in [Configuration caching](#configuration-caching). Secrets are not cached in the persistent store; they are held in the secret store.

### Secret store

Pre-shared secrets, as defined in [Pre-shared secrets](#pre-shared-secrets), are held in a secret store. The secret store may but need not be the same physical store as the persistent store. The backend validates presented secrets against the secret store during the token exchange.

- Secrets must not be cached in or readable from the persistent store.
- The specific secret store technology is an implementation concern; this specification requires that a secret store exists and that the backend can validate presented secrets against it.

### Usage tracking store

The backend tracks LLM usage to enforce the per-session spend caps and global rate limits defined in [Cost and abuse controls](#cost-and-abuse-controls). Usage is tracked in a store that persists across serverless invocations.

- **Per-session usage.** The backend records accumulated LLM spend for each session, keyed by a session identifier derived from the token. The backend checks this record before forwarding an LLM call and refuses the call if the session's spend cap is reached.
- **Global rate limiting.** The backend records LLM call counts (or spend) globally or per tier, keyed by a time window. The backend checks this record before forwarding an LLM call and refuses the call if the rate limit is reached.
- Per-session usage records are discarded when the session ends. Global rate-limit records are retained for the duration of their time window and then discarded.
- The usage tracking store may but need not be the same physical store as the persistent store or the secret store. The specific technology is an implementation concern.

```gherkin
Feature: Backend stores
  Rule: Three logical stores — persistent (content + config cache), secret, usage tracking — which may share a physical store

  Scenario: Configuration cached in the persistent store
    Given the backend has resolved configuration from the content repo and environment
    When the backend caches the resolved configuration
    Then the cache must be in the persistent store
    And the cache must not include secrets

  Scenario: Secrets held in the secret store
    Given the operator has issued pre-shared secrets
    Then the secrets must be held in the secret store
    And the secrets must not be readable from the persistent store

  Scenario: Usage tracked across invocations
    Given a serverless invocation incurs LLM spend for a session
    When a subsequent invocation checks the session's spend
    Then the usage tracking store must return the accumulated spend
    And the backend must refuse the call if the spend cap is reached
```

## Relationship to other specifications

- [Runtime](./runtime.spec.md) — the runtime runs on the frontend across Web Workers; the backend is not on the runtime. The runtime's worker placement, service host activation, Transferable object support, and the bootstrap orchestration are defined there. This specification governs only the deployment-level topology (what runs on the frontend vs the backend) and the external dependencies.
- [User interface](./ui.spec.md) — the UI runs on the frontend's main thread; the `session_start` event and the Service Worker (transparent token handling) are defined there. This specification requires that the frontend application provides an entry point that mounts the UI and starts the instance, and that a Service Worker performs transparent token handling as defined there.
- [Constrained agent](./constrained-agent.spec.md) — the agentic model (event queue, flush policy, interaction triggering, budget) and the Guide's agent loop run on the frontend; LLM calls are proxied through the backend. This specification establishes the Guide definition as an assembly input that shapes the Guide without altering the agentic model, and establishes the deployment-level policy that session state persistence is per-tier configurable; the persistence mechanism (what persists, how, the carryover shape) is defined by the constrained agent spec.
- [Content model](./content-model.spec.md) — the compiled model is produced by the backend and stored in the persistent store; the frontend retrieves it over HTTP.
- [Content-first retrieval](./content-first-retrieval.spec.md) — retrieval executes on the backend (querying the persistent store); the frontend's retrieval service is backed by HTTP-client providers that call the backend. The retrieval interface, required indexes, client-side caching behaviour, cache invalidation interface (`since` parameter + invalidation list), table of contents, and per-index provider interfaces are defined there. This specification governs only the deployment-level topology (where retrieval executes) and the external persistent-store dependency.
- [Authoring tooling](./authoring-tooling.spec.md) — the backend compiles source Markdown from a content source on webhook, conforming to the compilation contract. Content-specific configuration lives in the content repository.
- [Annotations](./annotations.spec.md) — annotations are part of the compiled model and retrieved as document metadata; they are not session state.
- [Agent safety](./agent-safety.spec.md) — the safety consultant is an LLM call proxied through the backend, like the Guide's own LLM calls; the `safety_consult` cost is a policy parameter, bounded by the same spend caps.
- [Policy and configuration](./policy-and-configuration.spec.md) — the cross-cutting structural contract for policy parameters (existence, defined value, type, documentation) is defined there. This specification owns the configuration delivery mechanism for a Darkling instance: the configuration source, the default profile, the resolution order, static resolution, the developer-facing configuration API, the configuration sources, conventions and defaults, and resolution at startup. Domain specs that define policy parameters link to policy-and-configuration for the structural contract and to this specification for the delivery mechanism.

## Conformance

An implementation conforms to this specification when:

- a Darkling instance is assembled from the reusable Darkling software with project-specific Archive content, a Guide definition, and configuration, through the composition boundary, and provides a frontend application entry point and a backend application entry point;
- the instance builds and deploys to both supported targets — Vercel (static frontend + serverless backend) and local Node.js (Vite dev server or local static server + local Node backend) — with the same observable behaviour differing only in external-dependency provisioning and serving origin;
- the frontend is a static build (produced by Vite) served by the hosting platform, running the UI, the Guide agent loop, and the retrieval service, with a Service Worker for transparent token handling; the in-frontend worker placement conforms to [Runtime](./runtime.spec.md) and [User interface](./ui.spec.md);
- the backend is a serverless application that proxies the LLM (holding the API key, abstracted behind a provider interface) and serves retrieval from a persistent store, reading source Markdown from a content source and recompiling on webhook; the backend uses three logical stores — a persistent store (compiled content model and non-secret configuration cache), a secret store (pre-shared secrets), and a usage tracking store (per-session spend and global rate-limit counters) — which may share a physical store;
- the Guide definition is provided as an assembly input (a hybrid of a free-form voice section and optional typed greeting and safety-posture fields), lives in the content repository versioned with the worldbuilding, and is composed by the backend into the prompt alongside the constrained-agent framing and annotations, shaping the Guide's personality and in-fiction behaviour without altering the constrained-agent agentic model;
- the LLM provider is abstracted behind a provider interface and selected by configuration, swappable without changing the constrained-agent specification or the frontend;
- configuration is provided through a developer-facing configuration API that reads content-specific configuration from the content repository and operational configuration from the deployment environment, applies conventions and defaults, validates values, resolves them at startup, and provides them to subsystems at construction time; the configuration object is organised into sections by concern (content, llm, stores, access, guide, retrieval, runtime), constructed at the frontend and backend entry points from the resolved sources over a system-wide default profile, with the frontend excluding backend-only sections and secrets; a configuration source abstraction provides resolved values, the default profile gives a value for every policy parameter with overrides taking precedence, and policy values are resolved once at startup and remain fixed for the session, as defined in [Application configuration API](#application-configuration-api); the backend caches resolved non-secret configuration in the persistent store; pre-shared secrets are held in the secret store, not in the deployment environment;
- the compiled content model is stored in the persistent store and served by the backend over HTTP; the frontend is not shipped the compiled model as a static asset;
- access is governed by a secret-for-token exchange: pre-shared secrets (issued out of band, carrying predetermined rights) are exchanged for signed tokens (PASETO/JWT) with the rights as claims; anonymous Visitors receive an anonymous token automatically; no logon flow; a Service Worker manages the token lifecycle transparently, attaching `Authorization: Bearer` headers to backend requests, with application code unaware of tokens;
- a session is a browser visit; session state persistence (working memory, budget carryover) is configurable per access tier, with persistent tiers resuming prior state on return visits and ephemeral tiers discarding it at visit end;
- the backend enforces a per-session spend cap and a global rate limit, tier-dependent (from the token's claims), with the cap hit presented as an in-world rest message; the backend tracks LLM usage in a usage tracking store that persists across serverless invocations, refusing LLM calls when caps or limits are reached.