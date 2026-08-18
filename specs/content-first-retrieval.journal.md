# Journal: Content-first retrieval

This journal records the development of [content-first-retrieval.spec.md](./content-first-retrieval.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created as the fifth specification, in response to a request to establish the content-first retrieval spec referenced by the three-way interaction, content model, and constrained agent specs. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Query interface + storage.** The spec covers both the retrieval query interface (what the Guide can ask for and what it gets back) and the storage/indexing mechanisms that back retrieval. The specific storage technology is left to implementation, but the required indexes are normative.
- **Result shape defined.** The spec defines what each retrieval mode returns: full blocks for block retrieval, document metadata (without constituent block content) for document retrieval, and relationship-type-plus-block for traversal. Pagination is defined with cursor and has-more.
- **Both documents and blocks.** The retrieval interface covers both principal objects. Documents are addressable by ID and slug; blocks by ID. Document retrieval returns metadata, not constituent content; the Guide retrieves content via blocks.

## Dependencies on not-yet-established specifications

This specification links to one spec that does not yet exist at the time of writing:

- `specs/authoring-tooling.spec.md` — owns the property schema, including which properties are filterable and the match semantics per property.

When that specification is established, this journal should be updated to confirm the link resolves and that the referenced behaviour is consistent with the requirements stated here.

### Update: authoring tooling spec established

The authoring tooling spec has been established as [authoring-tooling.spec.md](./authoring-tooling.spec.md). It resolves the property schema gap: filterable properties (document slug, document title, block title, block document) and their match semantics (exact, substring) are defined, and non-filterable properties (content, relationships, children, parent) are explicitly listed. The content-first retrieval spec's reference to the property schema is confirmed as consistent.

## Key decisions and rationale

### Content-first, not query-engine

The README describes the retrieval model as "somewhere between RAG and KAG": the Guide navigates and interprets content rather than querying a formal knowledge graph. The spec makes this normative: retrieval presents textual content and navigable structure, with relationships as an additional navigation mechanism. No formal entailment is required. This is consistent with the content model's design context.

### Four retrieval modes

The four modes (by ID, by properties, by text, relationship traversal) correspond to the README's description: "retrieve blocks directly by ID, search by selected properties such as title, or search their textual content. Relationships between blocks provide an additional navigation mechanism." Each mode is a distinct query interface with its own parameters and result shape.

### Full block results, no partial-field retrieval

Block retrieval returns complete blocks (all fields from the content model data contract). There is no partial-field retrieval mode. This keeps the retrieval interface simple and ensures the Guide always has the full context of a block. The trade-off is potentially larger result payloads, but this is managed by pagination and the cost-based budget.

### Document results exclude constituent content

Document retrieval returns metadata (ID, slug, title, root block ID) but not the content of constituent blocks. To explore a document's content, the Guide retrieves the root block by ID and traverses the containment hierarchy. This keeps document retrieval lightweight and encourages the Guide to navigate the structure rather than receiving an entire document at once.

### Inbound traversal supported

The content model spec stores outbound relationships on each block. The retrieval spec requires a reverse index for inbound traversal, so the Guide can find blocks that reference a given block. This is important for the Guide's navigation: "what refers to this?" is as useful as "what does this refer to?"

### Containment index distinct from relationship index

Containment (parent–child) is structural and untyped, while relationships are semantic and typed. The spec uses separate indexes for each, reflecting the content model's distinction between containment and relationships. The containment index supports hierarchy traversal; the relationship index supports semantic traversal.

### Pagination with opaque cursor

Pagination uses an opaque cursor returned with each result set and passed back for the next page. The cursor is opaque to the Guide — it doesn't need to understand its structure, just pass it back. This is provider-agnostic and avoids exposing offset/limit internals.

### Deterministic default ordering

Retrieval by properties defaults to ordering by document ID then block ID, ensuring deterministic results. Text search is ranked by relevance (non-deterministic in the sense that ranking depends on the query). Relationship traversal preserves compiled order. Deterministic ordering matters for reproducibility and testing.

### Property filterability is schema-defined

Not all properties are filterable — the set of filterable properties and their match semantics are owned by the authoring tooling spec's property schema. The retrieval spec requires that retrieval by a non-filterable property is rejected, preventing ad-hoc filtering of arbitrary fields.

## Gaps and ambiguities

- **Property schema.** The spec references a property schema for filterable properties and match semantics, owned by the authoring tooling spec. The interface between the two should be confirmed when the authoring tooling spec is established.
- **Text search mechanism.** The spec leaves the text search mechanism (full-text, vector, hybrid) as a policy parameter. The choice has significant implications for retrieval quality and cost; this may warrant further specification.
- **Ranking function.** The ranking function for text search is a policy parameter. The specific function is not prescribed.
- **Result size and cost.** Full block results may be large. The spec relies on the cost-based budget to manage this, but the relationship between result size and tool call cost is not specified in detail.
- **Cross-document text search.** The spec states that document text search searches the content of constituent blocks, but does not define how a document-level text search result is presented (as a document, as blocks, or as a hybrid).
- **Cursor invalidation.** The spec does not address what happens if the underlying store changes between paginated requests (e.g. new content compiled). The cursor may become invalid; behaviour in this case is undefined.
- **Concurrency.** The spec does not address concurrent retrieval requests from parallel tool calls within a turn. The storage and indexes must support concurrent reads, but this is not stated normatively.
- **Cache invalidation interface.** [Usage and deployment](./usage-and-deployment.spec.md#client-side-retrieval-and-caching) defines a cache invalidation mechanism: the client sends a last-access timestamp on retrieval calls, and the backend returns a list of IDs whose cache entries are no longer valid. The specific retrieval API interface for this — the `since` parameter and the invalidation-list result shape — belongs in this specification (content-first-retrieval), to be established via the specification workflow. This is a future change to this spec.
