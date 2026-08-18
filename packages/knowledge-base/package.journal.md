# Journal: `@darkling/knowledge-base` package

This journal records the development of the `@darkling/knowledge-base` package — the implementation of [content-model.spec.md](../../specs/content-model.spec.md), [content-first-retrieval.spec.md](../../specs/content-first-retrieval.spec.md), and [authoring-tooling.spec.md](../../specs/authoring-tooling.spec.md) as defined by [package.spec.md](./package.spec.md). It is non-normative; the specifications take precedence.

## Origin

Created as the second implementation package, in response to a request to "implement a new package for content handling." Established via the specification workflow initiated by the user, covering all three content-related root specs in a single package.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **One package, three spec areas.** Unlike `@darkling/service-bus` (one package per spec area), the content-related specs are implemented as a single `@darkling/knowledge-base` package. The three specs are tightly coupled — the model, retrieval, and compilation are layers of one subsystem — and a single package keeps their conformance surfaces together. The package conforms to all three root specs; `package.spec.md` is the implementation contract spanning them.
- **Subpath exports.** The package exposes two subpaths: `@darkling/knowledge-base` (model types, retrieval library, store/indexes, service-bus integration) and `@darkling/knowledge-base/compiler` (the remark-based compiler). This isolates the unified/remark dependencies to the compiler subpath, so a consumer that only needs retrieval (e.g. the runtime in a Web Worker) does not pull the compiler's Markdown-parsing dependencies into its bundle.
- **Service-bus integration included.** The package provides a `knowledge-base` retrieval service (`ServiceDeclaration` + `ServiceImplementation`) that runs on the bus, as envisaged by [Service bus](../../specs/service-bus.spec.md#relationship-to-other-specifications). The compiler is a library export, not a bus service — compilation is a build-time or bootstrap-time operation, not a Guide tool call.
- **Compiler included in the first pass.** The remark-based compiler is implemented now, covering all three selected spec areas in one package.
- **Worker-safe, platform-neutral.** The package uses no Node.js or DOM APIs. Source material access and storage backends are injected via provider abstractions (`ContentSource`, `BlockStore`, etc.), so the package runs in a Web Worker, on the main thread, or in Node.js.
- **Modular storage/indexing providers with an in-memory linear-scan stub.** The user envisages Redis (possibly via Upstash REST) in production, but the storage and indexing are abstracted behind per-index interfaces with in-memory reference implementations. The in-memory `TextIndex` is a linear scan stub pending a real inverted or vector index; this is recorded as a gap below.

## Key decisions and rationale

### Per-index provider interfaces

[Content-first retrieval](../../specs/content-first-retrieval.spec.md#storage-and-indexing) names five distinct indexes: block store, property index, text index, relationship index, containment index. The package models each as its own interface (`BlockStore`, `PropertyIndex`, `TextIndex`, `RelationshipIndex`, `ContainmentIndex`) with an in-memory implementation. A `RetrievalEngine` composes them. This mirrors the spec's named indexes exactly and allows a future Redis/Upstash implementation to provide each index independently (e.g. Redis sets for the property index, RediSearch for the text index, Redis graphs or sets for the relationship index). The alternative — a single monolithic `KnowledgeBaseStore` interface — would have been simpler but coarser, and would have made per-index substitution harder.

### Opaque annotations field

[Annotations](../../specs/annotations.spec.md) defines annotations as document-level metadata surfaced in document retrieval results. No `@darkling/annotations` package exists yet. The package treats `Document.annotations` as `unknown[]` — opaque metadata passed through verbatim by the compiler and retrieval engine. This keeps the package decoupled from a not-yet-existing annotations package while satisfying the requirement that document retrieval results include annotations. When an `@darkling/annotations` package exists, the field can be narrowed to its `Annotation` type without changing the model or retrieval contract.

### Compiled content as rendered Markdown text

[Authoring tooling](../../specs/authoring-tooling.spec.md#compiled-content-format) resolves the content-format question deferred by [Content model](../../specs/content-model.spec.md): compiled block content is rendered Markdown text (a string), not mdast. The `ContentBlock.content` field is therefore `string`. The compiler uses remark to parse, strip semantic annotations, and stringify back to Markdown text.

### ID derivation scheme

[Authoring tooling](../../specs/authoring-tooling.spec.md#id-derivation) requires document IDs derived from file path and block IDs from document ID + heading structure, both independent of content and title, but leaves the specific normalisation to implementation. The chosen scheme:

- **Document ID** — the source file's relative path within the content directory, with the file extension removed, directory separators replaced by `/`, and the path lowercased and slugified segment-by-segment. e.g. `content/ceph-biology/overview.md` → `ceph-biology/overview`. This is path-derived (independent of content) and stable across recompilation of unchanged source.
- **Block ID** — `documentId + ':' + headingPath`, where `headingPath` is the sequence of heading positions (1-indexed among siblings at each level) joined by `.`. e.g. the first H2 under the first H1 is `ceph-biology/overview:1.1`. This is position-based (independent of heading text) and stable when the heading structure is unchanged. The scheme avoids slugified heading text because the spec requires IDs to be independent of heading text; a position-based structural identifier satisfies this directly.

This scheme is an implementation decision; the spec requires only that IDs are path/structure-derived, stable, and content-independent.

### Slug derivation and collision resolution

[Authoring tooling](../../specs/authoring-tooling.spec.md#slug-derivation) requires slugs derived from the root block title by slugification, unique, and deterministic, but leaves collision resolution to implementation. The chosen scheme: slugify the title (lowercase, non-alphanumeric stripped, whitespace → hyphens); on collision, append `-2`, `-3`, etc. to subsequent documents in deterministic (sorted by document ID) order. Collision resolution does not change document IDs. This is deterministic and produces unique slugs.

### Controlled vocabulary

[Authoring tooling](../../specs/authoring-tooling.spec.md#controlled-vocabularies) establishes the initial relationship type vocabulary: `references`, `describes`, `contrasts-with`, `derived-from`, `related-to`. No type is symmetric initially. The package exports this as `DEFAULT_RELATIONSHIP_TYPES` and rejects relationships with types outside the vocabulary at compilation, reporting the rejection.

### Text index as a linear scan stub

The in-memory `TextIndex` is a linear scan over all block content, ranking by a simple substring/term-frequency score. This is a stub for testing and bootstrap. The user envisages Redis (RediSearch or similar) in production; the `TextIndex` interface allows a real implementation to be substituted without changing the retrieval engine. The stub is conformant — the spec leaves the text search mechanism as a policy parameter — but it is not production-quality. Recorded as a gap below.

### Cursor implementation

[Content-first retrieval](../../specs/content-first-retrieval.spec.md#pagination-and-limits) requires an opaque cursor for pagination. The in-memory implementations use a cursor encoding the offset and the query parameters (base64-encoded JSON). The cursor is opaque to the consumer; its structure is an implementation detail. Cursor invalidation when the underlying store changes between paginated requests is not addressed (a known gap from the retrieval spec's journal).

### Service-bus integration: one retrieval service

The package exposes one `knowledge-base` service with all retrieval functions. The `KnowledgeBaseService` owns a `RetrievalEngine` and dispatches calls to it. The engine's providers are constructed from `KnowledgeBaseServiceOptions` carried by the `HostContext`, allowing the host to inject store configuration. The compiler is not a bus service — compilation is a build/bootstrap operation, not a Guide tool call. This matches the service-bus spec's framing of retrieval as a bus service and the constrained-agent spec's framing of knowledge base access as a tool category.

## Gaps and ambiguities

- **Text index is a linear scan stub.** The in-memory `TextIndex` is not production-quality. A real inverted or vector index (or a Redis/Upstash-backed implementation) is needed for production. The `TextIndex` interface allows substitution.
- **Redis/Upstash storage providers not implemented.** The per-index interfaces are designed for Redis/Upstash substitution, but only in-memory implementations are provided. A `@darkling/knowledge-base-redis` package (or in-package implementations) is a follow-up.
- **Annotations are opaque.** `Document.annotations` is `unknown[]`. Narrowing to a typed `Annotation` from a future `@darkling/annotations` package is a follow-up.
- **Webhook-triggered recompilation.** [Authoring tooling](../../specs/authoring-tooling.spec.md#recompilation-trigger) requires a webhook-triggered recompilation mechanism when content sources are external. The compiler supports recompilation (calling `compile()` again on a new `ContentSource`), but the webhook integration (payload format, affected-file mapping, triggering) is not implemented in this package — it belongs to the application layer that owns the content source lifecycle.
- **VS Code extension.** [Authoring tooling](../../specs/authoring-tooling.spec.md#vs-code-extension) mentions a VS Code extension for authoring assistance. Not implemented in this package; it is a separate concern.
- **Cursor invalidation.** Behaviour when the underlying store changes between paginated requests is undefined (a known gap from the retrieval spec's journal).
- **Cross-document text search presentation.** The retrieval spec's journal notes that document-level text search presentation (document vs blocks vs hybrid) is undefined. The initial implementation searches block content and returns blocks; document text search returns documents whose constituent blocks match, ranked by their best-matching block. This is an implementation decision; the spec is ambiguous here.
- **Duplicate and self-referential relationships.** The content model spec permits both by silence. The compiler does not reject them; this is conformant (permitted by silence) but may warrant spec clarification.
- **Shared compiler types with main subpath.** The compiler produces `Document` and `ContentBlock` types exported from the main subpath. The compiler subpath imports these from the main subpath, so the main subpath must be resolvable when compiling. This is fine in practice (both are in the same package) but means the compiler subpath is not fully standalone.
- **Configurable relationship types.** The controlled vocabulary is currently a fixed union (`RELATIONSHIP_TYPES` / `RelationshipType`) and the compiler's `CompilerOptions.relationshipTypes` defaults to `DEFAULT_RELATIONSHIP_TYPES`. The user has noted an interest in making relationship types configurable — allowing the vocabulary to be extended or replaced without changing the model types or the compiler. This would likely involve widening `RelationshipType` from a literal union to a branded string, and making the vocabulary a runtime-configured set rather than a compile-time union. Deferred; to return to later.
- **Content type on `Document`.** The user has noted an interest in adding a content type field to `Document` (e.g. to distinguish kinds of Archive material). The current `Document` carries only the required lower-bound fields (id, slug, rootBlock, annotations, metadata). A content type would be additional document metadata; whether it is a free-form label or a controlled vocabulary, and whether it is filterable, is undefined. Deferred; to return to later.

## Service declaration and implementation split

The initial implementation placed the service declaration and implementation in a single `service.ts` module, with the `implementationLoader` returning `Promise.resolve(KnowledgeBaseService)` — eagerly pulling the implementation into any consumer of the declaration. This defeated the purpose of the `implementationLoader` (lazy, on-demand loading) and coupled the declaration to the implementation at module-load time.

The user identified this and requested the split. The service is now split into two modules, each with its own entry point:

- **`service-implementation.ts`** — the `KnowledgeBaseService` class, `KnowledgeBaseServiceOptions`, and `KnowledgeBaseDeclaration`. This is the implementation module, loaded lazily.
- **`service-declaration.ts`** — the `ServiceDeclaration` (named `declaration` export, with `knowledgeBaseServiceDeclaration` as an alias). This is the `./service` subpath entry point. Its `implementationLoader` wraps a dynamic `import(/* @vite-ignore */ './service-implementation.js')`, returning a promise for the `KnowledgeBaseService` constructor.

This follows the service-bus package's host worker convention: the host worker dynamically imports a declaration module expecting `{ declaration: ServiceDeclaration }`, then calls `declaration.implementationLoader()` to lazily load the implementation class via `import()`. The split keeps the implementation out of the initial bundle — a consumer that only needs the declaration (e.g. the main thread creating a proxy) does not pull in the retrieval engine, the store implementations, or their dependencies.

### `./service` subpath

The declaration is exposed as the `./service` subpath (`@darkling/knowledge-base/service` → `./src/service-declaration.ts`), matching the host worker's expectation of a declaration module with a named `declaration` export. The declaration is also re-exported from the main subpath (`.`) as `knowledgeBaseServiceDeclaration` for consumers that import the package's public API directly.

### Proposed service-bus spec clarification

The service-bus root spec ([Service registration](../../specs/service-bus.spec.md#service-registration)) states that the declaration is registered with the broker and the implementation runs on a host, and that the declaration includes an `implementationLoader`. The `@darkling/service-bus` package's [package.spec.md](../service-bus/package.spec.md) documents the host worker's convention of importing a declaration module with a named `declaration` export and calling `implementationLoader()` to get the implementation class. However, neither normatively establishes:

1. that a service's declaration and implementation are separate modules (and separate entry points into the package);
2. that the `implementationLoader` should wrap a dynamic `import()` of the implementation module, returning a promise for the constructor;
3. that the declaration module exports the declaration as a named `declaration` export (the convention the host worker relies on).

A spec clarification is proposed to establish these as normative requirements, so that every service package follows the same pattern. This is recorded here pending the specification workflow; see the proposal in the conversation that produced this change.
