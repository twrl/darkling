# Journal: Content model

This journal records the development of [content-model.spec.md](./content-model.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created as the second specification, in response to a request to "establish a spec for the content model." Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Semantic content system, compiled model only.** The spec covers the compiled content model — addressable content blocks, structural metadata, typed relationships. Authoring tooling (semantically enriched Markdown, custom remark plugins, VS Code extension) is left to a separate spec, referenced as `specs/authoring-tooling.spec.md`.
- **Annotations excluded.** The Guide's private notes/recollections as annotations on Archive content are left to a dedicated spec, referenced as `specs/annotations.spec.md`. The content model spec notes that annotations attach to content blocks but does not define their structure.
- **Retrieval excluded.** The retrieval interface (by ID, by properties, by text, via relationships) is left to `specs/content-first-retrieval.spec.md`.
- **Location.** The spec lives at `specs/content-model.spec.md`, a shorter name than the `semantic-content-system.spec.md` path referenced by the three-way interaction spec. The three-way interaction spec's references were updated to point here.

## Dependencies on not-yet-established specifications

This specification links to three specs that do not yet exist at the time of writing:

- `specs/authoring-tooling.spec.md` — owns the source format, the controlled vocabulary for block kinds, and the compilation tooling.
- `specs/content-first-retrieval.spec.md` — owns the retrieval interface.
- `specs/annotations.spec.md` — owns the annotation model.

When those specifications are established, this journal should be updated to confirm the links resolve and that the referenced behaviour is consistent with the requirements stated here.

### Update: content-first retrieval spec established

The content-first retrieval spec has been established as [content-first-retrieval.spec.md](./content-first-retrieval.spec.md). It defines the four retrieval modes (by ID, by properties, by text, relationship traversal), result shapes, pagination, and the storage/indexing mechanisms. The content model's reference to content-first retrieval is confirmed as consistent.

### Update: authoring tooling spec established

The authoring tooling spec has been established as [authoring-tooling.spec.md](./authoring-tooling.spec.md). It resolves several gaps deferred from this spec:

- **Content format** — compiled block content is rendered Markdown text (not mdast).
- **ID derivation** — document IDs from file path, block IDs from document ID + heading structure; both independent of content.
- **Slug derivation** — slugified from the document title; collision resolution is deterministic and implementation-defined.
- **Controlled vocabulary** — relationship types vocabulary established (references, describes, contrasts-with, derived-from, related-to); no symmetric types initially.
- **Property schema** — filterable properties and match semantics defined.

The content model's references to authoring tooling are confirmed as consistent.

### Update: annotations spec established

The annotations spec has been established as [annotations.spec.md](./annotations.spec.md). It defines annotations as document-level metadata: authored in frontmatter, attached to the document as a whole (not to specific content blocks), compiled alongside documents, immutable at runtime, and retrieved as metadata on document retrieval results. This resolves the annotation attachment gap from this spec: annotations are document-level, not block-level, so there is no block-target resolution or unresolved-attachment rejection. The interface between the content model and annotations is confirmed: annotations extend the document's metadata, and the content-first retrieval spec's document result shape has been updated to include annotations.

## Key decisions and rationale

### Two-object model: documents and blocks

The initial draft used a single flat "content block" object with a `kind` field to distinguish structural roles. The user corrected this: the content model has two principal objects — **documents** and **content blocks** — with an explicit containment hierarchy. Blocks are markdown sections organised within documents; a document references a root block, and blocks reference a parent and list children. The `kind` field was removed; structural role is now expressed through the containment hierarchy (root vs. non-root) rather than a vocabulary. This is a cleaner model that matches how the README describes the Archive as documents the User navigates.

### Block structure

The user specified the block fields directly: unique ID, title, reference to containing document, optional parent reference, content, array of child references, relationships. The spec makes the parent–child relationship normatively consistent (bidirectional agreement required) and treats containment as distinct from typed semantic relationships.

### Document identity: ID and slug

The user specified "unique id and/or slug." Through dialogue, the decision was made that documents have both a stable unique ID and a stable unique slug, both required and both addressable. The slug is human-readable (for navigation/display); the ID is the canonical reference target. This mirrors the block ID contract while adding a human-readable address.

### Content representation left open

The user flagged uncertainty about the best content representation (Markdown text vs. mdast). The decision was to require a "structured representation of the block's markdown section" but defer the exact format to the authoring tooling spec. The data contract's `content` field is therefore left without a JSON type, with a description pointing to the authoring tooling spec.

### IDs are independent of content; document title is its root block's title

The user asked whether block IDs need to be derived from block content. The decision was no: IDs must be independent of content and title. This decouples identity from content, so that editing a block's content (e.g. fixing a typo) does not change its ID and therefore does not break relationships or references targeting it. This also resolves the "circular identity definition" gap flagged in the review: content changes no longer affect identity, so "a change that affects the block's identity" is a distinct, author-level concept (the block was replaced or its ID was changed), not a content edit.

The user further noted that a document's title is implicitly the title of its root block, and the slug can be derived from that. The spec now:

- makes a document's title the title of its root block (no separate title field);
- derives the document's slug from that title;
- keeps the document's ID independent of title and content, creating a deliberate asymmetry: the slug is content-derived and may change when the title changes; the ID is stable and is the canonical reference target. This is the right shape because relationships and references use IDs, while humans see slugs.

The same independence principle applies to block IDs: a block's ID is independent of its content and title.

### Dangling and unrecognised relationships must be reported

The review identified that the original draft didn't specify behaviour for dangling targets or unrecognised types beyond "not admitted." The revised spec requires compilation to _report_ both rejections, making the failures observable rather than silent.

### RAG/KAG middle ground as a normative constraint

The README describes the content model as "somewhere between RAG and KAG," retaining explicit semantic relationships while presenting primarily textual content. The spec makes this normative: the model must provide explicit, traversable relationships alongside textual content, and must not require formal entailment. This prevents a future implementation from drifting back toward an OWL2-RL-style entailment engine, which the README explicitly moved away from.

### Stable IDs as the addressability foundation

The three-way interaction spec and the (future) retrieval spec both depend on addressing blocks by ID. The spec makes ID stability across compilations normative, derived deterministically from source. This is the contract that lets the Guide retrieve blocks by ID reliably and lets relationships reference blocks by ID without dangling.

### Controlled vocabularies for kinds and relationship types

Both block kinds and relationship types are required to come from controlled vocabularies, and unrecognised relationship types must be rejected at compilation. This keeps the semantic structure legible and bounded, consistent with the README's emphasis on "explicit semantic relationships" rather than free-form graph edges. The vocabularies themselves are delegated to the authoring tooling spec, since they are an authoring concern.

### Directionality without symmetry by default

Relationships are directional and non-symmetric by default. The README's knowledge-graph lineage might suggest symmetric or bidirectional edges, but the spec requires explicit assertion of the reverse. This keeps the relationship graph precise and avoids inferring connections that were not authored.

### Minimal data contract with extension room

The JSON Schema defines the minimal required fields (id, title, kind, content, relationships) and explicitly permits additional metadata. This gives the authoring and retrieval specs room to extend without breaking the core contract, while keeping the conformance criteria verifiable.

## Gaps and ambiguities

- **ID derivation scheme.** The spec now requires IDs to be independent of content and title, and stable across compilations, but does not prescribe the derivation scheme (e.g. author-assigned, position-based, hash of a stable identifier). Deferred to the authoring tooling spec.
- **Slug derivation scheme.** The spec requires the slug to be derived from the document's root block title, but does not specify the exact derivation (e.g. slugification rules, uniqueness handling for title collisions). Deferred to the authoring tooling spec.
- **Controlled vocabularies.** The spec requires a controlled vocabulary for relationship types but does not enumerate it. The authoring tooling spec should establish it. (Note: the `kind` vocabulary is no longer needed since the two-object model replaced the `kind` field.)
- **Content format.** The `content` field's exact format (Markdown text, mdast, or other) is intentionally left open, deferred to the authoring tooling spec.
- **Document metadata.** The spec defines the minimal required document fields (ID, slug, rootBlock) and states additional metadata is "yet to be defined." This should be established as the project's metadata needs become clear.
- **Relationship metadata.** The data contract's relationship objects carry only `type` and `target`. Relationships may need their own metadata (e.g. provenance, confidence, authored notes). This is deferred.
- **Block versioning.** The spec addresses ID stability across recompilation but not how content changes are versioned or how a changed block relates to its prior identity. The "Compiling changed source" scenario notes the ID may change, but the policy is undefined.
- **Annotation attachment point.** The spec assumes annotations attach to content blocks but defers the attachment mechanism to the annotations spec. The interface between the two should be confirmed when the annotations spec is established.
- **Duplicate and self-referential relationships.** The spec does not state whether the same `(type, target)` pair may appear more than once on a block, or whether a block may relate to itself. Both are currently permitted by silence.
- **Inbound relationship traversal.** The data contract stores outbound relationships on each block. The spec does not define how inbound traversal is accomplished (scan all blocks vs. a separate index); this likely belongs in the retrieval spec.
- **Symmetric type declaration.** The spec allows a type to be "explicitly defined as symmetric" but does not define how symmetry is declared; this would live in the controlled vocabulary owned by the authoring tooling spec.
