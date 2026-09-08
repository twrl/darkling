# `@darkling/configurator` package — journal

This journal records the development of [package.spec.md](./package.spec.md). It is non-normative; the specification takes precedence.

## Creation

Created in response to the user's request for a "composer/configurator package" to realise the usage-and-deployment and policy-and-configuration specifications. The user specified a fluent TypeScript API for a configuration builder, plus tooling to consume that configuration, and described the instance model: a Darkling instance is a CommonJS package with `{ "type": "module" }` that exports a named `./darkling-config` entry point whose default export is a `Config`, `ConfigBuilder`, promise for either, or a sync/async factory function.

## Scope decisions

- **Package name: `@darkling/configurator`.** The user said "composer/configurator." "Configurator" was chosen as the package name because the package's primary purpose is configuration: the `Config` type, `ConfigBuilder`, default profile, and resolution. The "composer" aspect — assembling an instance — is realised through `loadInstance`, which loads the instance package and resolves its configuration. The name `@darkling/configurator` covers both concerns without overloading "composer."

- **Standalone, no Darkling package dependencies.** The configurator does not depend on `@darkling/guide`, `@darkling/knowledge-base`, or `@darkling/runtime`. The policy parameter types (budget policy, retrieval policy, runtime policy) are defined inline in this package's types, conforming to the owning specifications' parameter tables. This keeps the configurator a standalone tool that can be used without pulling in the subsystem packages, and avoids circular dependencies (the subsystem packages may eventually consume the configurator's `Config` type).

- **Inline policy types, not re-exports.** The `guide`, `retrieval`, and `runtime` sections of `Config` contain typed fields that correspond to the policy parameters defined by the constrained-agent, content-first-retrieval, and runtime specs. Rather than importing `BudgetPolicy` from `@darkling/guide` or `RetrievalPolicy` from `@darkling/knowledge-base`, these types are defined inline in the configurator. This is because (a) the configurator is the configuration authority and should own the configuration-facing types, (b) the owning specs define the parameters, not the TypeScript types — the types are an implementation concern of whichever package provides them, and (c) it avoids coupling. The inline types conform to the parameter tables in the owning specs. If the subsystem packages' types and the configurator's types diverge, the subsystem packages are responsible for consuming the configurator's `Config` and adapting.

- **Zod schemas for all sections.** Every section of `Config` has a Zod schema. This enforces the validation requirement: invalid values are rejected at resolution time. The schemas are the implementation of the "must conform to the type established by the owning specification" requirement from [Policy and configuration](../../specs/policy-and-configuration.spec.md).

- **ConfigBuilder is mutable during construction, produces immutable Config.** The builder accumulates overrides via fluent methods. `build()` resolves and validates, producing a frozen `Config`. This matches the "static resolution" requirement — once resolved, the config is fixed for the session.

- **Frontend vs backend config via optional sections.** The `Config` type uses optional sections (`llm?`, `stores?`, `access?`) rather than a separate `FrontendConfig` type. This keeps a single `Config` type and lets the builder's `frontend()` method exclude the backend-only sections. The spec requires that the frontend excludes backend-only sections and secrets; optional sections model this without duplicating the type.

- **GuideDefinition in the content section.** The Guide definition lives in the content repository (per the spec), so it is part of the `content` section of `Config`. This matches the spec's placement: "The Guide definition lives in the content repository, alongside the source Markdown and the content-specific configuration file."

- **loadInstance uses dynamic import.** The function accepts a module specifier string and uses `import()` to load the `./darkling-config` module. This works in both browser (via bundler) and Node.js contexts. The various export forms (Config, ConfigBuilder, Promise, factory) are resolved by checking the type of the export and unwrapping step by step.

- **Content source: inline content or git repo URL.** The instance model allows an instance to either contain content (inline) or configure an external git repository. The `content` section has a `source` field that can be either `{ type: 'inline', path: string }` or `{ type: 'git', url: string }`. This mirrors the spec's "A Darkling instance may contain content, or may configure an external git repository as a content source."

## Key decisions and rationale

### Fluent builder over plain object construction

The user explicitly requested a "fluent TypeScript API for a configuration builder." A plain object constructor (passing a config object to a function) would be simpler but less ergonomic for the application author. The fluent builder allows:

```typescript
const config = await createConfigBuilder()
  .content({ source: { type: 'git', url: 'https://github.com/me/my-world' } })
  .guide({ budgetPolicy: { base: 15 } })
  .retrieval({ defaultResultLimit: 50 })
  .frontend()
  .build();
```

The builder is the primary DX surface; `resolveConfig` is the lower-level function for programmatic resolution.

### Default profile values

The default profile values are chosen to match the existing implementation defaults in the codebase:

- `guide.budgetPolicy`: `{ base: 10, premium: { direct_address: 4 }, toolCosts: {} }` — matches `DEFAULT_BUDGET_POLICY` in `@darkling/guide`.
- `guide.triggerProbabilities`: per-event-type probabilities. The spec defines trigger probability per event type as a policy parameter. The default uses `1.0` for `direct_address` and `0.5` for others, matching the constrained-agent spec's examples.
- `retrieval`: matches `DEFAULT_RETRIEVAL_POLICY` in `@darkling/knowledge-base` — `textSearchMechanism: 'linear-scan'`, `defaultResultLimit: 20`, `defaultSortPolicy: 'document-then-block'`, and the default property schema.
- `runtime.broadcastChannelName`: `'darkling-state'` — matches the frontend's existing `StateManagerHostOptions.channelName`.
- `access`: tier policies matching the backend's `DEFAULT_TIERS` — anonymous `{ spendCap: 100, rateLimitPerMinute: 10 }`, token `{ spendCap: 1000, rateLimitPerMinute: 60 }`, operator `{ spendCap: null, rateLimitPerMinute: null }`.
- `content.relationshipTypes`: the five types from `RELATIONSHIP_TYPES` in `@darkling/knowledge-base`.

These values are implementation-defined; they are reasonable defaults for development and local operation, not normative values.

### ConfigBuilder.frontend() rather than separate builder

Rather than having `FrontendConfigBuilder` and `BackendConfigBuilder`, a single `ConfigBuilder` with a `frontend()` method was chosen. This is simpler and avoids duplicating the fluent API. Calling `frontend()` marks the builder so that `build()` excludes `llm`, `stores`, and `access` from the resolved `Config`, per the spec's requirement that "the frontend must not receive the LLM API key or backend-only sections."

## Gaps and ambiguities

- **Content-specific configuration shape.** The spec says the content repository's config file holds "content-specific policy (e.g. relationship-type vocabulary, document metadata policies, content-specific retrieval policy)." The exact shape of the content-specific config file (e.g. `darkling.json`) is an implementation concern. The configurator provides a `ContentConfig` type with the fields the spec mentions, but the mapping from a `darkling.json` file to this type is a concern of the backend's config reading, not this package.
- **Store connection types.** The `stores` section holds "persistent, secret, and usage tracking store connections." The specific connection types (URLs, tokens, options) are implementation concerns. The configurator provides a `StoresConfig` type with connection-string fields, but the mapping from these to actual store client instances is a concern of the backend.
- **LLM provider selection.** The `llm` section holds "the LLM provider selection and API key." The provider is identified by a string (e.g. `'openrouter'`, `'openai'`, `'anthropic'`). The mapping from this string to an actual provider implementation is a concern of the backend.
- **Guide definition loading.** The Guide definition lives in the content repository. The configurator includes `GuideDefinition` in the `content` section, but the loading of the Guide definition from the content repository (reading it alongside the source Markdown) is a concern of the backend's content compilation, not this package.
- **Schema for content-specific config file.** The `content/darkling.json` file in the repo is a development stand-in. Its schema is not normative. The configurator's `ContentConfig` type provides fields matching the current `darkling.json`, but a formal schema for the content config file is a follow-up.
- **Partial deep merge semantics.** The builder's section methods accept partial objects that are deep-merged with the default profile. The deep merge is shallow within each section (top-level fields in a section are merged; nested objects within a field are replaced, not deep-merged). This is a pragmatic choice: deep-mercing arbitrary nesting adds complexity without clear benefit for the current config shape. It may be revisited if config sections grow deeper nesting.
