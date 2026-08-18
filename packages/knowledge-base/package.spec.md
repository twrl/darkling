# `@darkling/knowledge-base` package

## Purpose and scope

This specification defines the `@darkling/knowledge-base` package: the implementation package that provides the compiled content model, the content-first retrieval library, and the compilation pipeline that transforms authored source material into the compiled model.

It governs:

- the package's public API surface — the types, classes, and functions exported from the package entry points and subpaths;
- the package's structural contract — the modules, their responsibilities, and their relationships;
- the storage and indexing provider abstractions and the in-memory reference implementations;
- the service-bus integration — the retrieval service declaration and implementation;
- the compiler — the remark-based pipeline that compiles semantically enriched Markdown into the compiled model;
- the package's dependencies and build configuration;
- the conformance of the package to [Content model](../../specs/content-model.spec.md), [Content-first retrieval](../../specs/content-first-retrieval.spec.md), and [Authoring tooling](../../specs/authoring-tooling.spec.md), which remain the normative specifications for their respective subsystems.

It is explicitly out of scope for this specification to define:

- the normative requirements of the content model, retrieval, or authoring tooling — which are defined by their respective root specifications;
- the annotation model — which is defined by [Annotations](../../specs/annotations.spec.md); this package treats annotations as opaque document metadata, as defined in [Annotations](#annotations);
- the service bus itself — which is defined by [Service bus](../../specs/service-bus.spec.md); this package provides a service that runs on the bus but does not define the bus;
- the constrained agent, event system, or three-way interaction model — which are defined by their respective specifications.

Where this specification depends on behaviour defined by the root specifications, it links to them and states its requirement in terms of the package's conformance to that specification. This specification is an implementation contract: it governs how the package is structured and consumed, not the behavioural requirements of the subsystems themselves.

## Relationship to the root specifications

This package conforms to three root specifications:

- [Content model](../../specs/content-model.spec.md) — defines the structure, identity, metadata, containment, typed relationships, and compilation contract of documents and content blocks. This package implements the compiled model types and the in-memory store that holds them.
- [Content-first retrieval](../../specs/content-first-retrieval.spec.md) — defines the four retrieval modes (by ID, by properties, by textual content, relationship traversal), result shapes, pagination, and the required storage and indexing mechanisms. This package implements the retrieval engine, the provider abstractions, and the in-memory reference indexes.
- [Authoring tooling](../../specs/authoring-tooling.spec.md) — defines the semantically enriched Markdown source format, the compilation process, ID and slug derivation, controlled vocabularies, the compiled content format (rendered Markdown text), and the property schema. This package implements the remark-based compiler.

The package does not restate the normative requirements of those specifications. Where the package makes an implementation decision that a root specification leaves open, that decision is recorded in [package.journal.md](./package.journal.md) and, where it has an observable effect on the package's public API, noted in this specification.

## Design context

The package occupies the "somewhere between RAG and KAG" position described by [Content model](../../specs/content-model.spec.md): it retains explicit, traversable semantic relationships while presenting content primarily as textual content and navigable structure. The retrieval engine never requires formal entailment; the compiler produces a model with explicit relationships alongside textual content.

The package is worker-safe: it uses no Node.js or DOM APIs and is intended to run inside a Web Worker (the service-bus host). All source material access and storage backends are injected via provider abstractions, keeping the package platform-independent. The package may also run on the main thread or in Node.js (e.g. for build-time compilation), since it depends only on platform-neutral TypeScript and the remark unified ecosystem.

## Public API surface

The package is consumed via two subpaths. The main subpath (`@darkling/knowledge-base`) provides the model types, retrieval library, provider abstractions, and service-bus integration. The compiler subpath (`@darkling/knowledge-base/compiler`) provides the compilation pipeline. Internal modules are not exported; consumers depend only on the public API.

### Main subpath (`@darkling/knowledge-base`)

#### Content model types

The package exports the compiled content model types defined by [Content model](../../specs/content-model.spec.md):

- `Document` — a compiled document: ID, slug, root block reference, and additional metadata (including opaque annotations, as defined in [Annotations](#annotations));
- `ContentBlock` — a compiled content block: ID, title, document reference, optional parent reference, content (rendered Markdown text, as defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#compiled-content-format)), child block references, and relationships;
- `Relationship` — a typed, directional relationship: type (from the controlled vocabulary) and target block ID;
- `RelationshipType` — the union of relationship types from the controlled vocabulary defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#controlled-vocabularies);
- `BlockId`, `DocumentId`, `Slug` — string-branded type aliases for identity fields.

The `ContentBlock.content` field is a `string` containing rendered Markdown text, as established by [Authoring tooling](../../specs/authoring-tooling.spec.md#compiled-content-format). This resolves the content-format question deferred by [Content model](../../specs/content-model.spec.md).

#### Retrieval types

The package exports the retrieval request and result types defined by [Content-first retrieval](../../specs/content-first-retrieval.spec.md):

- `DocumentResult` — a document retrieval result, conforming to the [Document result](../../specs/content-first-retrieval.spec.md#result-shapes) shape: ID, slug, title (root block title), root block ID, annotations, and additional metadata;
- `BlockResult` — a content block retrieval result, including the full block as defined by the [Content model](../../specs/content-model.spec.md) data contract;
- `TraversalResult` — a relationship traversal result entry: relationship type, related block ID, and the related block's full `BlockResult`;
- `PageResult<T>` — a paginated result set: items, cursor, and has-more flag, as defined by [Pagination and limits](../../specs/content-first-retrieval.spec.md#pagination-and-limits);
- `ByIdResult<T>` — a retrieval-by-ID result: resolved items (in requested order) and a not-found list, as defined by [Retrieval by ID](../../specs/content-first-retrieval.spec.md#retrieval-by-id);
- `PropertyCriterion` — a property criterion for retrieval by properties: property name and match value;
- `RetrievalPolicy` — the set of policy parameters defined by [Policy parameters](../../specs/content-first-retrieval.spec.md#policy-parameters): filterable properties, match semantics, text search mechanism, ranking function, default result limit, and default sort policy. A default policy is provided; consumers may override it.

The package exports the filterable property schema defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#property-schema):

- `FilterableDocumentProperty`, `FilterableBlockProperty` — unions of filterable property names;
- `DEFAULT_PROPERTY_SCHEMA` — the property schema mapping filterable properties to their match semantics, conforming to the table in [Authoring tooling](../../specs/authoring-tooling.spec.md#filterable-properties);
- `isFilterableDocumentProperty`, `isFilterableBlockProperty` — type guards.

#### Storage and indexing provider abstractions

The package exports interfaces for each of the five required indexes defined by [Storage and indexing](../../specs/content-first-retrieval.spec.md#storage-and-indexing), plus in-memory reference implementations. The interfaces are platform-neutral; the in-memory implementations are the testing and bootstrap path. A Redis or Upstash-backed implementation may be provided separately by consuming the same interfaces; this package does not depend on any external storage.

- `BlockStore` — holds compiled documents and content blocks; supports O(1) lookup by document ID, document slug, and block ID. The store is read-only with respect to the Guide, as defined by [Block store](../../specs/content-first-retrieval.spec.md#block-store). The interface declares `getDocumentById`, `getDocumentBySlug`, `getBlockById`, `putDocument`, `putBlock`, and `bulkLoad` (for populating the store from a compiled model).
- `PropertyIndex` — indexes filterable properties; supports conjunctive (logical AND) queries over multiple criteria. Declares `indexDocument`, `indexBlock`, `query`, and `bulkLoad`.
- `TextIndex` — indexes the textual content of all content blocks; supports relevance-ranked search. Declares `indexBlock`, `search`, and `bulkLoad`. The specific text indexing mechanism is a policy parameter; the in-memory implementation is a linear scan, recorded as a stub pending a real inverted or vector index, as noted in [package.journal.md](./package.journal.md).
- `RelationshipIndex` — indexes outbound and inbound relationships; supports filtering by relationship type. Declares `indexBlock`, `traverseOutbound`, `traverseInbound`, and `bulkLoad`.
- `ContainmentIndex` — indexes parent–child relationships; supports retrieval of a block's parent and children, and a document's full block tree. Declares `indexDocument`, `indexBlock`, `getParent`, `getChildren`, `getDocumentTree`, and `bulkLoad`.

The package exports `InMemoryBlockStore`, `InMemoryPropertyIndex`, `InMemoryTextIndex`, `InMemoryRelationshipIndex`, and `InMemoryContainmentIndex` as the reference implementations. Each is constructible independently and supports `bulkLoad(model)` to populate from a compiled model. A `createInMemoryStores()` factory returns a bundle of all five for convenience.

#### Retrieval engine

The package exports a `RetrievalEngine` class that composes the five provider abstractions and implements the four retrieval modes defined by [Content-first retrieval](../../specs/content-first-retrieval.spec.md#retrieval-modes):

- `getBlocksById(ids)` / `getDocumentsById(ids)` — retrieval by ID, returning `ByIdResult` with not-found reporting, as defined by [Retrieval by ID](../../specs/content-first-retrieval.spec.md#retrieval-by-id);
- `getDocumentBySlug(slug)` — slug resolution returning the document, as defined by [Retrieval by ID](../../specs/content-first-retrieval.spec.md#retrieval-by-id);
- `queryBlocks(criteria, page?)` / `queryDocuments(criteria, page?)` — retrieval by properties with logical AND, rejecting non-filterable properties, as defined by [Retrieval by properties](../../specs/content-first-retrieval.spec.md#retrieval-by-properties);
- `searchBlocks(query, page?)` / `searchDocuments(query, page?)` — retrieval by textual content, ranked by relevance, as defined by [Retrieval by textual content](../../specs/content-first-retrieval.spec.md#retrieval-by-textual-content);
- `traverseOutbound(blockId, typeFilter?, page?)` — outbound relationship traversal, as defined by [Relationship traversal](../../specs/content-first-retrieval.spec.md#relationship-traversal);
- `traverseInbound(blockId, typeFilter?, page?)` — inbound relationship traversal, as defined by [Inbound traversal](../../specs/content-first-retrieval.spec.md#inbound-traversal).

The engine is constructed with the five provider abstractions and a `RetrievalPolicy`. It applies pagination (limit, cursor, has-more) to the paginated modes, and the default ordering defined by [Result ordering](../../specs/content-first-retrieval.spec.md#result-ordering). The cursor is opaque to the consumer; its structure is an implementation detail of the engine and its providers.

#### Service-bus integration

The package provides a retrieval service that runs on the service bus, as envisaged by [Service bus](../../specs/service-bus.spec.md#relationship-to-other-specifications) ("the retrieval interface is accessed through services on the bus"). The service exposes the retrieval engine's operations as service functions, dispatched through the bus and validated with Zod schemas, as defined by [Service bus](../../specs/service-bus.spec.md#service-interface-contract).

The service declaration and implementation are separate modules, following the [interface and metadata separate from implementation](../../specs/service-bus.spec.md#service-registration) principle: the declaration is registered with the broker and imported by the host worker; the implementation is loaded lazily by the declaration's `implementationLoader`.

The package exports:

- `knowledgeBaseServiceDeclaration` — a `ServiceDeclaration` (from `@darkling/service-bus`) for the `knowledge-base` service, with Zod schemas for each retrieval function's parameters and return values. Its `implementationLoader` dynamically `import()`s the implementation module and returns the `KnowledgeBaseService` constructor. The declaration is exported from the `@darkling/knowledge-base/service` subpath (see [Service subpath](#service-subpath-darklingknowledge-baseservice)) and is also re-exported from the main subpath for convenience;
- `KnowledgeBaseService` — a `ServiceImplementation` (from `@darkling/service-bus`) that owns a `RetrievalEngine` and dispatches retrieval function calls to it. The engine's providers are constructed in the implementation's constructor from a `KnowledgeBaseServiceOptions` (passed via the `HostContext`), allowing the host to inject store configuration (e.g. in-memory for tests, a Redis-backed store for production);
- `KnowledgeBaseServiceOptions` — the options carried by the `HostContext`: the provider implementations or a factory for them, and the retrieval policy.

`@darkling/service-bus` is a peer dependency. Importing the service-bus integration does not require the compiler subpath; the service depends only on the model and retrieval API.

### Service subpath (`@darkling/knowledge-base/service`)

The service subpath is the service's entry point. It exports the `ServiceDeclaration` as a named `declaration` export, matching the convention by which the service-bus host worker dynamically imports a declaration module expecting `{ declaration: ServiceDeclaration }`, as defined by the `@darkling/service-bus` package's [host worker entry point](../service-bus/package.spec.md#worker-entry-points). The subpath also exports `knowledgeBaseServiceDeclaration` as an alias for `declaration`.

The declaration's `implementationLoader` wraps a dynamic `import()` of the implementation module (`./service-implementation.ts`), returning a promise for the `KnowledgeBaseService` constructor. This keeps the implementation out of the initial bundle and allows the host worker to load it on demand. The `import()` specifier is relative to the declaration module; bundlers must not statically analyse it (the `@vite-ignore` comment is used for Vite).

### Compiler subpath (`@darkling/knowledge-base/compiler`)

The compiler subpath provides the compilation pipeline defined by [Authoring tooling](../../specs/authoring-tooling.spec.md).

- `ContentSource` — an interface abstraction by which the compiler obtains source material. A `ContentSource` provides an async `read(path)` returning the file's Markdown text, and a `list()` returning the paths of source files within the content directory. The abstraction is platform-neutral: a Node.js implementation reads from the filesystem, a browser implementation fetches over HTTP, and an external-git-repository implementation reads from a cloned working copy. The package provides a `StaticContentSource` constructed from a map of path → content, for testing and for in-memory compilation.
- `Compiler` — the compiler class. Constructed with a `ContentSource` and a `CompilerOptions` (controlled vocabulary, ID/slug derivation scheme, content directory root). The `compile()` method produces a `CompiledModel` — the set of compiled documents, content blocks, and a compilation report (accepted relationships, rejected relationships with reasons, unresolved targets). Compilation is deterministic with respect to identity, slugs, containment, and relationships, as defined by [Compilation](../../specs/authoring-tooling.spec.md#compilation) and [Compilation contract](../../specs/content-model.spec.md#compilation-contract).
- `CompiledModel` — the output of compilation: documents, content blocks, and a `CompilationReport` (rejections with reasons).
- `compile(source, options?)` — a convenience function that constructs a `Compiler` and returns a `CompiledModel`.
- `slugify(title)` — the slug derivation function, as defined by [Slug derivation](../../specs/authoring-tooling.spec.md#slug-derivation).
- `deriveDocumentId(filePath)`, `deriveBlockId(documentId, headingPath)` — the ID derivation functions, as defined by [ID derivation](../../specs/authoring-tooling.spec.md#id-derivation). The specific normalisation scheme is an implementation decision recorded in [package.journal.md](./package.journal.md).
- `DEFAULT_RELATIONSHIP_TYPES` — the controlled vocabulary of relationship types, as defined by [Controlled vocabularies](../../specs/authoring-tooling.spec.md#controlled-vocabularies).

The compiler uses the unified/remark ecosystem (`unified`, `remark-parse`, `remark-frontmatter`, `remark-stringify`, and custom remark plugins for semantic annotations) to parse and compile the semantically enriched Markdown. These are dependencies of the compiler subpath only; the main subpath does not depend on them. The remark plugins are internal modules and are not exported.

## Annotations

Annotations are document metadata surfaced in document retrieval results, as defined by [Annotations](../../specs/annotations.spec.md) and [Document result](../../specs/content-first-retrieval.spec.md#result-shapes). This package does not define the annotation model; it treats annotations as an opaque `annotations` field on the `Document` and `DocumentResult`.

- `Document.annotations` is `unknown[]` — the package does not model the annotation structure. The compiler populates this field from frontmatter as opaque metadata; the retrieval engine passes it through verbatim.
- When an `@darkling/annotations` package exists, the `annotations` field may be narrowed to that package's `Annotation` type without changing the retrieval or model contract. This decision is recorded in [package.journal.md](./package.journal.md).

This keeps the package decoupled from a not-yet-existing annotations package while satisfying the requirement that document retrieval results include annotations as metadata.

## Module structure

The package is organised into modules, each with a single responsibility. Internal modules are not part of the public API but are documented here for maintainability.

| Module                             | Responsibility                                                                                                                                                                      | Spec reference                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`                         | `Document`, `ContentBlock`, `Relationship`, `RelationshipType`, branded ID types.                                                                                                   | [Content model](../../specs/content-model.spec.md)                                                                                                                                                                                                         |
| `retrieval-types.ts`               | Retrieval request and result types: `DocumentResult`, `BlockResult`, `TraversalResult`, `PageResult`, `ByIdResult`, `PropertyCriterion`, `RetrievalPolicy`.                         | [Content-first retrieval](../../specs/content-first-retrieval.spec.md)                                                                                                                                                                                     |
| `property-schema.ts`               | Filterable property schema, type guards, `DEFAULT_PROPERTY_SCHEMA`.                                                                                                                 | [Authoring tooling](../../specs/authoring-tooling.spec.md#property-schema)                                                                                                                                                                                 |
| `store.ts`                         | `BlockStore` interface and `InMemoryBlockStore`.                                                                                                                                    | [Block store](../../specs/content-first-retrieval.spec.md#block-store)                                                                                                                                                                                     |
| `property-index.ts`                | `PropertyIndex` interface and `InMemoryPropertyIndex`.                                                                                                                              | [Property index](../../specs/content-first-retrieval.spec.md#storage-and-indexing)                                                                                                                                                                         |
| `text-index.ts`                    | `TextIndex` interface and `InMemoryTextIndex` (linear scan stub).                                                                                                                   | [Text index](../../specs/content-first-retrieval.spec.md#storage-and-indexing)                                                                                                                                                                             |
| `relationship-index.ts`            | `RelationshipIndex` interface and `InMemoryRelationshipIndex`.                                                                                                                      | [Relationship index](../../specs/content-first-retrieval.spec.md#storage-and-indexing)                                                                                                                                                                     |
| `containment-index.ts`             | `ContainmentIndex` interface and `InMemoryContainmentIndex`.                                                                                                                        | [Containment index](../../specs/content-first-retrieval.spec.md#storage-and-indexing)                                                                                                                                                                      |
| `in-memory-stores.ts`              | `createInMemoryStores()` factory.                                                                                                                                                   | [Storage and indexing](../../specs/content-first-retrieval.spec.md#storage-and-indexing)                                                                                                                                                                   |
| `retrieval-engine.ts`              | `RetrievalEngine` — composes providers, implements the four retrieval modes, pagination, ordering.                                                                                  | [Retrieval modes](../../specs/content-first-retrieval.spec.md#retrieval-modes), [Result ordering](../../specs/content-first-retrieval.spec.md#result-ordering), [Pagination and limits](../../specs/content-first-retrieval.spec.md#pagination-and-limits) |
| `service-implementation.ts`        | `KnowledgeBaseService`, `KnowledgeBaseServiceOptions`, `KnowledgeBaseDeclaration`. Loaded lazily by the declaration's `implementationLoader`.                                       | [Service bus](../../specs/service-bus.spec.md#service-interface-contract)                                                                                                                                                                                  |
| `service-declaration.ts`           | `declaration` (named export), `knowledgeBaseServiceDeclaration` (alias). The `./service` subpath entry point. `implementationLoader` wraps `import()` of the implementation module. | [Service registration](../../specs/service-bus.spec.md#service-registration), [On-demand activation](../../specs/service-bus.spec.md#on-demand-activation)                                                                                                 |
| `index.ts`                         | Public API barrel export for the main subpath.                                                                                                                                      | —                                                                                                                                                                                                                                                          |
| `compiler/content-source.ts`       | `ContentSource` interface, `StaticContentSource`.                                                                                                                                   | [Content sources](../../specs/authoring-tooling.spec.md#content-sources)                                                                                                                                                                                   |
| `compiler/ids.ts`                  | `deriveDocumentId`, `deriveBlockId`, `slugify`, path/heading normalisation.                                                                                                         | [ID derivation](../../specs/authoring-tooling.spec.md#id-derivation), [Slug derivation](../../specs/authoring-tooling.spec.md#slug-derivation)                                                                                                             |
| `compiler/vocabulary.ts`           | `DEFAULT_RELATIONSHIP_TYPES`, controlled vocabulary.                                                                                                                                | [Controlled vocabularies](../../specs/authoring-tooling.spec.md#controlled-vocabularies)                                                                                                                                                                   |
| `compiler/remark-relationships.ts` | Custom remark plugin extracting relationship declarations from frontmatter.                                                                                                         | [Relationship declarations](../../specs/authoring-tooling.spec.md#relationship-declarations)                                                                                                                                                               |
| `compiler/remark-content.ts`       | Custom remark plugin stripping semantic annotations and producing rendered Markdown text.                                                                                           | [Compiled content format](../../specs/authoring-tooling.spec.md#compiled-content-format)                                                                                                                                                                   |
| `compiler/compiler.ts`             | `Compiler`, `CompiledModel`, `CompilationReport`, `compile`.                                                                                                                        | [Compilation](../../specs/authoring-tooling.spec.md#compilation)                                                                                                                                                                                           |
| `compiler/index.ts`                | Public API barrel export for the compiler subpath.                                                                                                                                  | —                                                                                                                                                                                                                                                          |

## Dependencies and build configuration

- **Package manager** — pnpm 11, as defined by the workspace.
- **Build orchestration** — Turbo, as defined by the workspace. The package defines `lint`, `check-types`, and `test` scripts; it has no build step (it is consumed as TypeScript source, mirroring `@darkling/service-bus`).
- **TypeScript** — extends `@repo/typescript-config/base.json`, `noEmit`, including `src` and `test`.
- **ESLint** — uses `@repo/eslint-config/base`, mirroring `@darkling/service-bus`.
- **Testing** — Vitest, as defined by the workspace `vitest.config.ts`.
- **Runtime** — `zod` is a dependency (used by the model schemas and the service-bus integration). `@darkling/service-bus` is a peer dependency (required only when consuming the service-bus integration). The compiler subpath depends on `unified`, `remark-parse`, `remark-frontmatter`, `remark-stringify`, and `mdast` types; these are dependencies of the package, isolated to the compiler subpath so the main subpath does not pull them into a consumer's bundle.
- **Exports** — `package.json` `exports` maps `.` to `./src/index.ts` (main subpath), `./compiler` to `./src/compiler/index.ts` (compiler subpath), and `./service` to `./src/service-declaration.ts` (service subpath, the declaration entry point), mirroring `@darkling/service-bus`'s source-as-entry pattern.

## Conformance

The package conforms to its root specifications when:

- the compiled model types conform to the [Content model](../../specs/content-model.spec.md) data contracts for documents and content blocks;
- the retrieval engine supports all four retrieval modes (by ID, by properties, by textual content, relationship traversal — outbound and inbound) with the result shapes, ordering, and pagination defined by [Content-first retrieval](../../specs/content-first-retrieval.spec.md);
- the block store, property index, text index, relationship index, and containment index are provided as interfaces with in-memory reference implementations, supporting the required lookups defined by [Content-first retrieval](../../specs/content-first-retrieval.spec.md#storage-and-indexing);
- the block store is read-only with respect to the Guide;
- retrieval by a non-filterable property is rejected, and the filterable properties and match semantics conform to the property schema defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#property-schema);
- the compiler produces documents and content blocks conforming to [Content model](../../specs/content-model.spec.md) from semantically enriched Markdown, satisfying the compilation contract (deterministic identity, slugs, containment, relationships; rejection of unrecognised relationship types and unresolved targets with reporting);
- document and block IDs are derived from source file paths and heading structure, independent of content and title, as defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#id-derivation);
- document slugs are derived from the root block title by slugification, are unique, and change when the title changes, as defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#slug-derivation);
- compiled block content is rendered Markdown text, as defined by [Authoring tooling](../../specs/authoring-tooling.spec.md#compiled-content-format);
- the relationship types controlled vocabulary conforms to [Authoring tooling](../../specs/authoring-tooling.spec.md#controlled-vocabularies);
- the retrieval service exposes the retrieval engine's operations through the service bus, with Zod-validated parameters and returns, as defined by [Service bus](../../specs/service-bus.spec.md#service-interface-contract);
- all retrieval policy parameters have defined values, as defined by [Content-first retrieval](../../specs/content-first-retrieval.spec.md#policy-parameters).
