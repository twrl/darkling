# Content model

## Purpose and scope

This specification defines the compiled content model of the Archive: the two principal objects — **documents** and **content blocks** — their identity, structure, metadata, relationships, and the compilation contract that transforms authored source material into the compiled model.

It governs:

- documents as units of Archive material;
- content blocks as markdown sections organised within documents;
- the containment hierarchy relating documents, blocks, and their parent and child blocks;
- the identity and addressability of documents and blocks;
- the typed, directional relationships between blocks;
- the compilation contract — the observable properties of the process that transforms authored source material into the compiled model.

It is explicitly out of scope for this specification to define:

- the authoring format and tooling that produce source material — including semantically enriched Markdown, custom remark plugins, and the VS Code extension — which are defined by [Authoring tooling](./authoring-tooling.spec.md);
- the exact format of compiled block content (e.g. Markdown text, mdast, or another structured representation), which is deferred to [Authoring tooling](./authoring-tooling.spec.md);
- the retrieval interface by which the Guide queries and traverses blocks — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- the annotation model by which the Guide's private notes and recollections attach to content — which is defined by [Annotations](./annotations.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Design context

The content model occupies a position between retrieval-augmented generation and knowledge-augmented generation. It retains explicit semantic relationships between content blocks, providing structured, navigable knowledge; but it presents the Guide primarily with textual content and navigable structure rather than acting as a formal entailment engine or a database query interface.

This design choice is normative for this specification: the content model must provide explicit, traversable relationships while presenting content as text. It must not require formal entailment to satisfy its contracts.

## Documents

A document is a unit of Archive material. It is the principal navigable unit: the User navigates between documents, and the Guide may navigate the interface to present a document.

A document consists of:

- a unique ID;
- a slug;
- a reference to its root content block;
- additional metadata, the required fields of which are established below as a lower bound.

### Identity and addressability

Each document must have a stable, unique identifier (its ID) and a stable, unique slug.

- A document's ID must be stable across compilations of the same source material.
- A document's ID must uniquely identify the document within the Archive.
- A document's slug must be stable across compilations of the same source material.
- A document's slug must be unique within the Archive.
- A document must be addressable by its ID and by its slug: given either, the system must be able to resolve exactly one document.

The slug is a human-readable identifier, suitable for use in navigation and display. It is derived from the document's title (see [Title](#title)); the derivation scheme is defined by [Authoring tooling](./authoring-tooling.spec.md).

A document's ID must be independent of its content and title: changes to the document's content or title must not change its ID.

```gherkin
Feature: Document identity
  Rule: A document's ID is independent of its title; its slug is derived from its title

  Scenario: Title change changes slug but not ID
    Given document D has ID "doc-1", slug "ceph-biology", and title "Ceph Biology"
    When the title of D's root block is changed to "Cephalopod Biology"
    Then D's slug must be derived from the new title
    But D's ID must remain "doc-1"
```

### Root content block

Each document must reference exactly one root content block. The root content block is the entry point to the document's content: presenting a document means presenting its root content block and, by default, its descendants.

### Metadata

A document must carry, at minimum, the fields defined above (ID, slug, root content block reference). Additional metadata is yet to be defined; the set of required metadata fields established here is a lower bound. Other specifications and the authoring system may extend a document's metadata.

### Title

A document does not carry a separate title field. A document's title is the title of its root content block. Consequently, a document's slug is derived from the title of its root block.

## Content blocks

A content block is a markdown section. Content blocks are the atomic units of content within a document, organised into a containment hierarchy.

A content block consists of:

- a unique ID;
- a title;
- a reference to its containing document;
- an optional reference to a parent block;
- content;
- an array of references to child blocks;
- relationships.

### Identity and addressability

Each content block must have a stable, unique identifier (its ID).

- A block's ID must be stable across compilations of the same source material.
- A block's ID must uniquely identify the block within the Archive.
- A block must be addressable by its ID: given an ID, the system must be able to resolve exactly one block.
- A block's ID must be independent of its content and title: changes to the block's content or title must not change its ID.

```gherkin
Feature: Block identity
  Rule: Each block has a stable, unique, resolvable ID

  Scenario: Resolving a block by ID
    Given a content block with ID "ceph-biology:overview"
    When the block is resolved by ID
    Then exactly one block must be returned
    And the returned block must have ID "ceph-biology:overview"

  Scenario: ID stability across compilations
    Given source material that compiles to a block with ID "ceph-biology:overview"
    When the source material is recompiled without changes to the block
    Then the resulting block must have the same ID "ceph-biology:overview"

  Scenario: Content change does not change ID
    Given a block with ID "ceph-biology:overview" and content C
    When the block's content is changed to C'
    Then the block's ID must remain "ceph-biology:overview"
```

### Containment hierarchy

Content blocks are organised into a containment hierarchy within each document.

- Each block must reference its containing document.
- A block may reference a parent block. A block with no parent reference is a root block.
- A block must list its child blocks as an array of references. A block with no children has an empty array.
- The root content block referenced by a document must have no parent. All other blocks in a document must have a parent.
- The parent–child relationship must be consistent: if block A lists block B as a child, then block B must list block A as its parent.

Containment is structural: it reflects the organisation of content within a document. It is distinct from the typed semantic relationships defined in [Typed relationships](#typed-relationships).

```gherkin
Feature: Containment hierarchy
  Rule: Parent and child references must be consistent

  Scenario: Consistent parent-child references
    Given block A lists block B as a child
    Then block B must list block A as its parent

  Scenario: Root block has no parent
    Given block R is the root content block of document D
    Then block R must have no parent reference
    And document D must reference block R as its root content block
```

### Content

Each block must carry content: a structured representation of the block's markdown section.

- The content is the primary representation presented to the Guide and the User.
- The exact format of the compiled content (e.g. Markdown text, mdast, or another structured representation) is defined by [Authoring tooling](./authoring-tooling.spec.md). This specification requires only that the content be a structured representation of the authored markdown section.
- The content model must not require the consumer to perform formal entailment over the content to use it.

### Title

Each block must carry a human-readable title.

## Typed relationships

Content blocks participate in typed relationships with other content blocks. Relationships are the explicit semantic structure of the Archive and provide a navigation mechanism distinct from textual search.

### Directionality

Relationships must be directional: each relationship has a source block, a type, and a target block.

- A relationship's source and target must both be content blocks resolvable by ID.
- A relationship must not be assumed to be symmetric unless its type is explicitly defined as symmetric. By default, the reverse of a relationship is a distinct, separately asserted relationship.

### Types

Relationship types must be drawn from a controlled vocabulary. A relationship type identifies the semantic nature of the connection between two blocks (e.g. "references", "describes", "contrasts-with").

- The controlled vocabulary of relationship types must be finite and known to the system.
- A relationship with an unrecognised type must not be admitted into the compiled model, and the compilation must report the rejection.

### Dangling targets

A relationship whose target does not resolve to a content block must not be admitted into the compiled model, and the compilation must report the unresolved target.

```gherkin
Feature: Typed relationships
  Rule: Relationships are directional, typed, and must resolve

  Scenario: Traversing a relationship
    Given block A has a relationship of type "references" to block B
    When the relationships of block A are traversed
    Then a relationship of type "references" from A to B must be found
    And a relationship from B to A must not be inferred unless explicitly asserted

  Scenario: Rejecting an unrecognised relationship type
    Given source material asserts a relationship of type "vaguely-related-to"
    And "vaguely-related-to" is not in the controlled vocabulary
    When the source material is compiled
    Then the relationship must not be admitted into the compiled model
    And the compilation must report the rejection

  Scenario: Rejecting a dangling relationship target
    Given source material asserts a relationship from block A to target "nonexistent"
    And no block with ID "nonexistent" exists
    When the source material is compiled
    Then the relationship must not be admitted into the compiled model
    And the compilation must report the unresolved target
```

### Relationships vs. containment vs. text

Relationships, containment, and textual content are distinct and complementary:

- relationships provide explicit, navigable semantic links between blocks;
- containment provides the structural hierarchy of blocks within a document;
- textual content provides the substantive material of each block.

A consumer may use any or all. The content model must not require a consumer to traverse relationships to read a block's content, must not require a consumer to parse content to discover relationships, and must not require a consumer to traverse the containment hierarchy to read a block's content.

## Compilation contract

Authored source material is compiled into content blocks. This specification defines the observable properties of compilation; the source format and tooling are defined by [Authoring tooling](./authoring-tooling.spec.md).

### Compilation properties

Compilation must:

- produce documents and content blocks conforming to the identity, structure, metadata, content, and relationship requirements defined above;
- assign each document a stable ID that is independent of its content and title, such that unchanged source produces unchanged IDs;
- assign each document a slug derived from the title of its root block, such that unchanged source produces unchanged slugs;
- assign each block a stable ID that is independent of its content and title, such that unchanged source produces unchanged IDs;
- reject relationships whose types are not in the controlled vocabulary, and report the rejection;
- reject relationships whose targets do not resolve, and report the unresolved target;
- preserve the directionality of asserted relationships;
- produce a consistent containment hierarchy: parent and child references must agree, and each document's root block must have no parent.

Compilation may:

- merge, split, or restructure source material into blocks as defined by [Authoring tooling](./authoring-tooling.spec.md);
- enrich documents and blocks with additional metadata beyond the required minimum.

### Determinism

Compilation must be deterministic with respect to identity and structure: compiling the same source material must produce documents and blocks with the same IDs, the same slugs, the same containment hierarchy, and the same relationships. Compilation need not be deterministic with respect to non-identity metadata that has no bearing on addressability, containment, or relationship traversal.

```gherkin
Feature: Compilation determinism
  Rule: Compilation is deterministic with respect to identity, structure, and relationships

  Scenario: Recompiling unchanged source
    Given source material S compiles to documents and blocks with IDs, slugs, hierarchy H, and relationships R
    When S is recompiled
    Then the resulting documents and blocks must have the same IDs and slugs
    And the resulting containment hierarchy must equal H
    And the resulting relationships must equal R

  Scenario: Compiling changed source
    Given source material S compiles to a block with ID "x"
    When S is modified in a way that changes the block's content but not its identity
    Then the resulting block must have the same ID "x"
    And the resulting block must have the new content
```

## Data contract

The following JSON Schemas describe the minimal data contracts of a compiled document and a compiled content block. Extensions may add fields but must not remove or repurpose the fields defined here.

### Document

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Document",
  "type": "object",
  "required": ["id", "slug", "rootBlock"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable, unique identifier for the document."
    },
    "slug": {
      "type": "string",
      "description": "Stable, unique, human-readable slug for the document."
    },
    "rootBlock": {
      "type": "string",
      "description": "ID of the document's root content block."
    }
  }
}
```

### Content block

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Content block",
  "type": "object",
  "required": ["id", "title", "document", "content", "children", "relationships"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable, unique identifier for the block."
    },
    "title": {
      "type": "string",
      "description": "Human-readable title."
    },
    "document": {
      "type": "string",
      "description": "ID of the containing document."
    },
    "parent": {
      "type": ["string", "null"],
      "description": "ID of the parent block, or null for a root block."
    },
    "content": {
      "description": "Structured representation of the block's markdown section. Exact format defined by Authoring tooling."
    },
    "children": {
      "type": "array",
      "items": { "type": "string" },
      "description": "IDs of child blocks, in order."
    },
    "relationships": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type", "target"],
        "properties": {
          "type": {
            "type": "string",
            "description": "Relationship type, from a controlled vocabulary."
          },
          "target": {
            "type": "string",
            "description": "ID of the target block."
          }
        }
      }
    }
  }
}
```

## Conformance

An implementation conforms to this specification when:

- all Archive material is compiled into documents and content blocks conforming to the data contracts above;
- each document has a stable, unique, resolvable ID and a slug derived from its root block's title, and references exactly one root content block;
- each block has a stable, unique, resolvable ID that is independent of its content and title, a title, content, a containing-document reference, a child-block array, and relationships;
- the containment hierarchy is consistent: parent and child references agree, and each document's root block has no parent;
- relationships are directional, typed from a controlled vocabulary, and reject unrecognised types and unresolved targets;
- compilation is deterministic with respect to identity, slugs, containment, and relationships;
- the model provides explicit, traversable relationships alongside textual content, without requiring formal entailment.
