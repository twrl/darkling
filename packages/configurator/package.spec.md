# `@darkling/configurator` package

## Purpose and scope

This specification defines the `@darkling/configurator` package: the implementation package that provides the configuration model, the fluent configuration builder API, the default profile, configuration resolution, and Darkling instance loading — the tooling by which an application author assembles and configures a Darkling instance.

It governs:

- the package's public API surface — the types, classes, and functions exported from the package entry point;
- the `Config` type — the resolved, typed configuration object organised into the seven sections defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md#application-configuration-api);
- the `ConfigBuilder` — the fluent API by which an application author constructs a `Config` or a partial configuration providing overrides;
- the default profile — the system-wide default configuration that provides a value for every policy parameter, as defined by [Default profile](../../specs/usage-and-deployment.spec.md#default-profile);
- configuration resolution — the resolution order (override over default), validation, and rejection of unresolved or invalid parameters, as defined by [Resolution order](../../specs/usage-and-deployment.spec.md#resolution-order) and [Static resolution](../../specs/usage-and-deployment.spec.md#static-resolution);
- the `GuideDefinition` type — the hybrid assembly input (voice, greeting, safety posture) defined by [Guide definition](../../specs/usage-and-deployment.spec.md#guide-definition);
- instance loading — the mechanism by which a Darkling instance package is loaded from its `./darkling-config` entry point, accepting a `Config`, `ConfigBuilder`, promise for either, or a synchronous or asynchronous factory function;
- the package's dependencies and build configuration.

It is explicitly out of scope for this specification to define:

- the normative configuration delivery model — which is defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md#application-configuration-api);
- the cross-cutting structural contract for policy parameters — which is defined by [Policy and configuration](../../specs/policy-and-configuration.spec.md);
- the specific policy parameters of any subsystem — which are defined by their respective domain specifications;
- the specific values of the default profile beyond the requirement that they conform to their owning specifications' types — the values are implementation-defined;
- the backend's content compilation, LLM proxy, or store connection logic — which are implementation concerns of the backend application;
- the frontend's bootstrap or worker topology — which are defined by [Runtime](../../specs/runtime.spec.md) and [User interface](../../specs/ui.spec.md).

Where this specification depends on behaviour defined by the root specifications, it links to them and states its requirement in terms of the package's conformance to that specification. This specification is an implementation contract: it governs how the package is structured and consumed, not the behavioural requirements of the subsystems themselves.

## Relationship to the root specifications

This package conforms to:

- [Usage and deployment](../../specs/usage-and-deployment.spec.md) — defines the application configuration API (sections, sources, default profile, resolution order, static resolution), the Guide definition structure, the composition boundary, and the instance structure. This package implements the configuration model, builder, resolution, and instance loading that the specification requires.
- [Policy and configuration](../../specs/policy-and-configuration.spec.md) — defines the cross-cutting structural contract for policy parameters (existence, defined value, type, documentation). This package's resolution enforces that contract: it validates values against their types, rejects invalid values, and ensures every parameter has a defined value.
- [Constrained agent](../../specs/constrained-agent.spec.md#policy-parameters) — owns the Guide's constrained-agent policy parameters (trigger probabilities, budget composition, tool call costs). This package's `guide` section references these parameter types.
- [Content-first retrieval](../../specs/content-first-retrieval.spec.md#policy-parameters) — owns the retrieval policy parameters (filterable properties, match semantics, text search mechanism, default result limit, default sort policy). This package's `retrieval` section references these parameter types.
- [Runtime](../../specs/runtime.spec.md#policy-parameters) — owns the runtime policy parameters (broadcast channel name). This package's `runtime` section references this parameter type.

The package does not restate the normative requirements of those specifications. Where the package makes an implementation decision that a root specification leaves open, that decision is recorded in [package.journal.md](./package.journal.md).

## Design context

A Darkling instance is assembled from the reusable Darkling software with three project-specific inputs: Archive content, the Guide definition, and configuration. An application author constructs a configuration object at the frontend and backend entry points, resolving the content repository's config file and the deployment environment against the system-wide default profile.

This package provides the tooling for that construction: a typed `Config` object, a fluent `ConfigBuilder` API, a `defaultProfile` that provides a value for every policy parameter, a `resolveConfig` function that applies the resolution order and validates, and a `loadInstance` function that loads a Darkling instance from its package entry point.

The package is platform-neutral: it uses no Node.js or DOM APIs and depends only on TypeScript and Zod. It is intended to run both on the frontend (at the frontend entry point) and on the backend (at the backend entry point), as defined by [Instance structure and entry point](../../specs/usage-and-deployment.spec.md#instance-structure-and-entry-point).

## Instance model

A Darkling instance corresponds to a CommonJS package with `{ "type": "module" }` where:

- the package exports a named entry point `./darkling-config` which is a module;
- that module has a default export which is a `Config`, a `ConfigBuilder`, a `Promise` for either of them, or a synchronous or asynchronous factory function that produces one of them.

A Darkling instance may contain content, or may configure an external git repository as a content source.

The `loadInstance` function loads a Darkling instance from its package's `./darkling-config` entry point, resolving the various export forms into a `Config`:

1. import the `./darkling-config` module from the instance package;
2. read the default export;
3. if the export is a function, call it (with no arguments) to obtain a `Config`, `ConfigBuilder`, or a `Promise` for either;
4. if the result is a `ConfigBuilder`, call its `.build()` method to resolve the `Config`;
5. if the result or any intermediate value is a `Promise`, await it;
6. the final result must be a `Config`; if it is not, the load fails.

The `loadInstance` function must accept the various export forms and produce a resolved `Config`. It must report a clear error if the export does not conform to any accepted form.

## Public API surface

The package is consumed via the main subpath (`@darkling/configurator`). Internal modules are not exported.

### Config type

The `Config` type is the resolved, typed configuration object. It is organised into the seven sections defined by [Top-level structure](../../specs/usage-and-deployment.spec.md#top-level-structure):

- `content` — the content source location and content-specific configuration: the content repository URL (operational) and content-specific configuration values (relationship-type vocabulary, document metadata policies, content-specific retrieval policy).
- `llm` — the LLM provider selection and API key. The API key is held by the backend and must not appear in the frontend's configuration object. The `llm` section is absent from the frontend's `Config`.
- `stores` — the persistent, secret, and usage tracking store connections. The `stores` section is absent from the frontend's `Config`.
- `access` — the per-tier access configuration: spend caps and rate limits per access tier, and the session state persistence policy per access tier. The `access` section is absent from the frontend's `Config`.
- `guide` — the Guide's constrained-agent policy parameters (trigger probabilities, budget composition, tool call costs, overspend, carryover).
- `retrieval` — the retrieval policy parameters (filterable properties, match semantics, text search mechanism, default result limit, default sort policy).
- `runtime` — the runtime policy parameters (broadcast channel name).

A `Config` may be a full configuration (all sections present, for the backend) or a frontend configuration (excluding `llm`, `stores`, and `access`). The `Config` type uses optional sections to model this: the backend provides all sections; the frontend provides only the sections its subsystems consume.

The `Config` type is validated by a Zod schema. The schema validates each section's structure and the types of its fields, as required by [Validation](../../specs/usage-and-deployment.spec.md#validation). Invalid values are rejected at resolution time.

### GuideDefinition type

The `GuideDefinition` type is the hybrid assembly input defined by [Guide definition](../../specs/usage-and-deployment.spec.md#guide-definition):

- `voice` — a free-form text section defining the Guide's personality, manner, and voice. Required.
- `greeting` — optional typed field(s) defining how the Guide may greet a Visitor on session start.
- `safetyPosture` — a typed field defining the Guide's safety disposition.

The `GuideDefinition` is part of the `content` section of the `Config`, as it lives in the content repository alongside the source Markdown.

### ConfigBuilder

The `ConfigBuilder` is a fluent API for constructing a `Config` or a partial configuration providing overrides. It provides methods for setting each section's values, chaining method calls. The builder accumulates overrides; when `build()` is called, the overrides are resolved against the default profile, validated, and a `Config` is produced.

The `ConfigBuilder` must:

- provide a method for each section (`content()`, `llm()`, `stores()`, `access()`, `guide()`, `retrieval()`, `runtime()`) that accepts the section's values and returns the builder for chaining;
- provide a `build()` method that resolves the accumulated overrides against the default profile, validates the result, and returns a `Config`;
- accept partial overrides: a section method may provide some fields and not others; unprovided fields retain the default profile's value;
- accept a `frontend()` method that marks the builder as producing a frontend configuration, excluding `llm`, `stores`, and `access` sections from the resolved `Config`;
- reject invalid values at `build()` time, reporting the rejection.

### Default profile

The `defaultProfile` is the system-wide default configuration, as defined by [Default profile](../../specs/usage-and-deployment.spec.md#default-profile). It provides a value for every policy parameter defined by the domain specifications. It is documented and identified as the system default.

The `defaultProfile` must:

- provide a value for every policy parameter in every section;
- conform to the types established by the owning specifications;
- be importable and usable as a baseline against which overrides are applied.

The specific values of the `defaultProfile` are implementation-defined. This package provides a default profile that conforms to the parameter types; the values are chosen to be reasonable defaults for development and local operation.

### Configuration resolution

The `resolveConfig` function applies the resolution order defined by [Resolution order](../../specs/usage-and-deployment.spec.md#resolution-order):

1. for each parameter, if an override is provided, the override's value is used;
2. if no override is provided, the default profile's value is used;
3. if neither is provided, the parameter is unresolved and the resolution fails;
4. each resolved value is validated against its parameter's type;
5. invalid values are rejected and reported.

The `resolveConfig` function must:

- accept a partial overrides object (the overrides) and the default profile;
- merge overrides over defaults, with overrides taking precedence;
- validate the merged result against the `Config` Zod schema;
- return a `Config` on success or throw on failure (unresolved or invalid parameters).

### Instance loading

The `loadInstance` function loads a Darkling instance from its package's `./darkling-config` entry point, as defined by [Instance model](#instance-model).

The `loadInstance` function must:

- accept a module specifier or URL for the instance package's `./darkling-config` entry point;
- import the module, read the default export, and resolve it into a `Config` according to the accepted export forms;
- support `Config`, `ConfigBuilder`, `Promise<Config>`, `Promise<ConfigBuilder>`, sync factory `() => Config | ConfigBuilder`, and async factory `() => Promise<Config | ConfigBuilder>`;
- call `ConfigBuilder.build()` if a `ConfigBuilder` is encountered;
- return a `Config` on success or throw on failure.

## Dependencies

The package depends on:

- `zod` — for schema validation of configuration values.

The package has no runtime dependencies on other Darkling packages. The policy parameter types referenced by the `guide`, `retrieval`, and `runtime` sections are defined inline in this package's types, conforming to the owning specifications' parameter tables. This keeps the configurator a standalone tool that does not couple to the subsystem packages.

## Conformance

An implementation conforms to this specification when:

- the `Config` type is organised into the seven sections defined by [Top-level structure](../../specs/usage-and-deployment.spec.md#top-level-structure), with each section's fields conforming to the types established by their owning specifications;
- the `ConfigBuilder` provides a fluent API for each section, accepts partial overrides, and produces a `Config` via `build()` that resolves overrides against the default profile;
- the `defaultProfile` provides a value for every policy parameter, conforming to the types established by the owning specifications, and is documented as the system default;
- the `resolveConfig` function applies the resolution order (override over default), validates resolved values against their types, rejects invalid and unresolved parameters, and reports rejections;
- the `loadInstance` function loads a Darkling instance from its `./darkling-config` entry point, accepting all supported export forms, and produces a resolved `Config`;
- the `GuideDefinition` type has a required `voice` field and optional `greeting` and `safetyPosture` fields, conforming to [Guide definition](../../specs/usage-and-deployment.spec.md#guide-definition);
- a frontend `Config` excludes the `llm`, `stores`, and `access` sections, as required by [Top-level structure](../../specs/usage-and-deployment.spec.md#top-level-structure);
- the package is platform-neutral, using no Node.js or DOM APIs.
