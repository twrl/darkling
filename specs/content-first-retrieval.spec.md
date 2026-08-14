# Content-first retrieval

## Purpose and scope

This specification defines the content-first retrieval model: the interface by which the Guide retrieves documents and content blocks from the Archive, and the storage and indexing mechanisms that back retrieval.

It governs:

- the retrieval query interface: retrieval by ID, by selected properties, by textual content, and by relationship traversal;
- the result shapes returned by each retrieval mode;
- pagination and limits on retrieval results;
- the storage and indexing mechanisms that support retrieval;
- the retrieval of both documents and content blocks.

It is explicitly out of scope for this specification to define:

- the content model — the structure, identity, metadata, and relationships of documents and content blocks — which is defined by [Content model](./content-model.spec.md);
- the constrained agent's tool-call discipline, the knowledge base access tool category, and the budget — which are defined by [Constrained agent](./constrained-agent.spec.md) and [Event system](./event-system.spec.md);
- the three-way interaction model — which is defined by [Three-way interaction](./three-way-interaction.spec.md);
- the authoring format and compilation tooling — which are defined by [Authoring tooling](./authoring-tooling.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Design context

The retrieval model is content-first: the Guide navigates and interprets the Archive's content rather than acting as a database query engine. Retrieval presents the Guide primarily with textual content and navigable structure, while retaining explicit semantic relationships as an additional navigation mechanism.

This is the "somewhere between RAG and KAG" position described by [Content model](./content-model.spec.md): the Archive provides structured knowledge, but the Guide retrieves and interprets content rather than querying a formal knowledge graph. Retrieval must not require the Guide to perform formal entailment.

## Addressable objects

Retrieval covers both principal objects of the content model:

- **documents** — addressable by ID and by slug, as defined by [Content model](./content-model.spec.md);
- **content blocks** — addressable by ID, as defined by [Content model](./content-model.spec.md).

A retrieval request may target either object type. Document retrieval returns document objects; block retrieval returns content block objects. The result shape for each is defined in [Result shapes](#result-shapes).

## Retrieval modes

The Guide may retrieve content through four modes. Each mode is a distinct query interface with its own parameters and result shape.

### Retrieval by ID

Retrieval by ID returns the document or content block with a specified ID.

- **Parameters** — one or more IDs. Document retrieval accepts document IDs; block retrieval accepts block IDs.
- **Resolution** — each ID must resolve to exactly one object, as defined by [Content model](./content-model.spec.md). An ID that does not resolve must be reported as not found; it must not cause the entire retrieval to fail.
- **Result** — the resolved objects, in the order of the requested IDs. Objects for unresolved IDs are omitted from the result; the result must indicate which requested IDs were not found.

Document retrieval by slug is a distinct operation: a slug resolves to exactly one document, as defined by [Content model](./content-model.spec.md). Slug resolution returns the document; it does not return blocks.

```gherkin
Feature: Retrieval by ID
  Rule: IDs resolve to exactly one object; unresolved IDs are reported

  Scenario: Retrieving blocks by ID
    Given blocks with IDs "a", "b", and "c" exist
    When the Guide retrieves blocks by IDs ["a", "b", "nonexistent"]
    Then the result must include blocks "a" and "b"
    And the result must report "nonexistent" as not found

  Scenario: Retrieving a document by slug
    Given a document with slug "ceph-biology" exists
    When the Guide retrieves a document by slug "ceph-biology"
    Then the result must include the document
```

### Retrieval by properties

Retrieval by properties returns documents or content blocks matching a set of property criteria.

- **Parameters** — one or more property criteria. A property criterion specifies a property name and a match value. The match semantics (exact, prefix, substring) are defined per property by the property schema established by [Authoring tooling](./authoring-tooling.spec.md).
- **Filterable properties** — not all properties are filterable. The set of filterable properties is defined by the property schema. Retrieval by a non-filterable property must be rejected.
- **Result** — objects matching all criteria (logical AND), in an order defined by the sort policy. The default sort order is defined in [Result ordering](#result-ordering).

```gherkin
Feature: Retrieval by properties
  Rule: Property criteria are combined with logical AND

  Scenario: Retrieving blocks by title
    Given blocks with titles "Ceph Biology" and "Ceph Technology" exist
    When the Guide retrieves blocks by title matching "Ceph Biology"
    Then the result must include only the block titled "Ceph Biology"

  Scenario: Non-filterable property rejected
    Given "content" is not a filterable property
    When the Guide retrieves blocks by content matching "cephalopod"
    Then the retrieval must be rejected
```

### Retrieval by textual content

Retrieval by textual content returns documents or content blocks whose content matches a text query.

- **Parameters** — a text query. The query is matched against the textual content of blocks (and, for documents, the content of their constituent blocks).
- **Match semantics** — the text query is matched using a text search mechanism. The specific mechanism (e.g. full-text search, semantic similarity, hybrid) is a policy parameter, as defined in [Policy parameters](#policy-parameters).
- **Result** — objects whose content matches the query, ranked by relevance. The ranking function is a policy parameter. Results are subject to pagination, as defined in [Pagination and limits](#pagination-and-limits).

Textual search is distinct from property-based retrieval: it searches the content of blocks rather than their metadata. The content model requires that a consumer must not need to parse content to discover relationships, but textual search is a retrieval mode that deliberately searches content.

```gherkin
Feature: Retrieval by textual content
  Rule: Text search returns content-matching objects ranked by relevance

  Scenario: Text search for a term
    Given blocks containing "cephalopod" exist
    When the Guide retrieves blocks by text query "cephalopod"
    Then the result must include blocks whose content matches "cephalopod"
    And the result must be ranked by relevance
```

### Relationship traversal

Relationship traversal returns the content blocks related to a specified block via typed relationships, as defined by [Content model](./content-model.spec.md).

- **Parameters** — a source block ID, and optionally a relationship type filter. If a type filter is provided, only relationships of that type are traversed; if omitted, all relationship types are traversed.
- **Direction** — traversal follows outbound relationships from the source block. Inbound traversal (finding blocks that reference the source) is supported as a distinct operation, as defined in [Inbound traversal](#inbound-traversal).
- **Result** — the target blocks of the traversed relationships, with the relationship type included for each result. Results are subject to pagination, as defined in [Pagination and limits](#pagination-and-limits).

#### Inbound traversal

Inbound traversal returns blocks that have a relationship targeting the source block.

- **Parameters** — a target block ID, and optionally a relationship type filter.
- **Result** — the source blocks of relationships targeting the specified block, with the relationship type included for each result.

Inbound traversal requires a reverse index, as defined in [Storage and indexing](#storage-and-indexing).

```gherkin
Feature: Relationship traversal
  Rule: Traversal follows typed, directional relationships

  Scenario: Outbound traversal
    Given block A has a relationship of type "references" to block B
    When the Guide traverses outbound relationships from A
    Then the result must include block B with relationship type "references"

  Scenario: Outbound traversal with type filter
    Given block A has relationships of type "references" to B and "describes" to C
    When the Guide traverses outbound relationships from A with type filter "references"
    Then the result must include block B
    And the result must not include block C

  Scenario: Inbound traversal
    Given block A has a relationship of type "references" to block B
    When the Guide traverses inbound relationships to B
    Then the result must include block A with relationship type "references"
```

## Result shapes

Each retrieval mode returns objects in a defined shape.

### Document result

A document retrieval result includes:

- the document's ID;
- the document's slug;
- the document's title (the title of its root content block, as defined by [Content model](./content-model.spec.md));
- the ID of the document's root content block;
- the document's annotations, as metadata defined by [Annotations](./annotations.spec.md);
- any additional document metadata defined by [Content model](./content-model.spec.md).

A document result does not include the content of its constituent blocks. To retrieve a document's content, the Guide retrieves the document's root content block by ID and traverses the containment hierarchy.

### Content block result

A content block retrieval result includes:

- the block's ID;
- the block's title;
- the block's content;
- the block's containing document reference;
- the block's parent reference (if any);
- the block's child block references;
- the block's relationships.

A content block result includes the full block as defined by the [Content model](./content-model.spec.md) data contract. Retrieval returns complete blocks; there is no partial-field retrieval mode.

### Relationship traversal result

A relationship traversal result includes, for each related block:

- the relationship type;
- the target (for outbound) or source (for inbound) block ID;
- the related block's full content block result.

### Retrieval by ID: not-found reporting

Retrieval by ID results include, for each requested ID:

- the resolved object, if the ID resolves;
- a not-found indication, if the ID does not resolve.

## Result ordering

Retrieval results are ordered as follows:

- **Retrieval by ID** — results are in the order of the requested IDs.
- **Retrieval by properties** — results are in an order defined by the sort policy. The default sort policy is by document ID, then by block ID, to ensure deterministic ordering. Alternative sort policies may be defined as policy parameters.
- **Retrieval by textual content** — results are ranked by relevance, as defined by the ranking function policy parameter.
- **Relationship traversal** — results are in the order of the relationships as stored. The order of relationships on a block is the order in which they were compiled, as defined by [Content model](./content-model.spec.md).

## Pagination and limits

Retrieval modes that may return large result sets (retrieval by properties, retrieval by textual content, and relationship traversal) support pagination.

- **Limit** — a retrieval request may specify a maximum number of results. If omitted, a default limit is applied, as defined in [Policy parameters](#policy-parameters).
- **Cursor** — a retrieval request may include a cursor indicating the position to continue from a previous result set. The cursor is opaque to the Guide: it is returned with a result set and passed back to retrieve the next page.
- **Has-more** — a result set must indicate whether more results are available beyond the current page.

Retrieval by ID does not support pagination: it returns all resolved objects for the requested IDs, since the number of results is bounded by the number of IDs requested.

```gherkin
Feature: Pagination and limits
  Rule: Large result sets are paginated with a cursor

  Scenario: Paginated text search
    Given a text query matches 50 blocks
    And the default limit is 10
    When the Guide retrieves blocks by text query "cephalopod"
    Then the result must include 10 blocks
    And the result must indicate more results are available
    And the result must include a cursor

  Scenario: Continuation with cursor
    Given a previous text search returned a cursor
    When the Guide retrieves blocks by text query "cephalopod" with the cursor
    Then the result must include the next 10 blocks
    And the result must not include blocks from the first page
```

## Storage and indexing

The retrieval interface is backed by storage and indexing mechanisms. This specification defines the required indexes; the specific storage technology is an implementation concern.

### Block store

The block store holds all compiled documents and content blocks, as defined by [Content model](./content-model.spec.md). It is the source of truth for content.

- The block store must support retrieval by ID (document ID, document slug, and block ID) with O(1) lookup.
- The block store must be read-only with respect to the Guide: retrieval must not alter the store.

### Property index

The property index supports retrieval by properties.

- The property index must index all filterable properties, as defined by the property schema.
- The property index must support conjunctive (logical AND) queries over multiple property criteria.

### Text index

The text index supports retrieval by textual content.

- The text index must index the textual content of all content blocks.
- The text index must support relevance-ranked search.
- The specific text indexing mechanism (e.g. inverted index, vector index, hybrid) is a policy parameter, as defined in [Policy parameters](#policy-parameters).

### Relationship index

The relationship index supports relationship traversal.

- The relationship index must index outbound relationships: given a source block ID, it must return all relationships from that block, with their types and targets.
- The relationship index must index inbound relationships: given a target block ID, it must return all relationships to that block, with their types and sources.
- The relationship index must support filtering by relationship type.

### Containment index

The containment index supports traversal of the containment hierarchy.

- The containment index must index parent–child relationships: given a block ID, it must return the block's parent and children.
- The containment index must support retrieval of a document's full block tree, starting from the root block.

The containment index is distinct from the relationship index: containment is structural (defined by [Content model](./content-model.spec.md)) and is not typed.

```gherkin
Feature: Storage and indexing
  Rule: The retrieval interface is backed by required indexes

  Scenario: ID lookup
    Given a block with ID "x" exists in the block store
    When the Guide retrieves block "x" by ID
    Then the block store must return the block in O(1) lookup

  Scenario: Inbound relationship lookup
    Given block A references block B
    When the Guide traverses inbound relationships to B
    Then the relationship index must return A with type "references"
```

## Policy parameters

The retrieval model is governed by a set of policy parameters. This specification defines the parameters that must exist and their required properties; the specific values are implementation-defined and may be configurable.

| Parameter                | Description                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Filterable properties    | The set of properties that may be used in retrieval by properties.                    |
| Property match semantics | The match semantics (exact, prefix, substring) for each filterable property.          |
| Text search mechanism    | The mechanism used for retrieval by textual content (e.g. full-text, vector, hybrid). |
| Ranking function         | The function used to rank text search results by relevance.                           |
| Default result limit     | The default maximum number of results returned when no limit is specified.            |
| Default sort policy      | The default ordering for retrieval by properties results.                             |

All policy parameters must have defined values. An implementation must not leave any parameter undefined.

## Conformance

An implementation conforms to this specification when:

- the Guide may retrieve documents and content blocks by ID, with unresolved IDs reported as not found;
- the Guide may retrieve documents by slug;
- the Guide may retrieve documents and content blocks by filterable properties, with criteria combined by logical AND;
- the Guide may retrieve content blocks by textual content, ranked by relevance;
- the Guide may traverse outbound and inbound relationships, with optional type filtering;
- retrieval results conform to the result shapes defined above;
- paginated retrieval modes support limit, cursor, and has-more;
- the block store, property index, text index, relationship index, and containment index are maintained and support the required lookups;
- the block store is read-only with respect to the Guide;
- all policy parameters have defined values.
