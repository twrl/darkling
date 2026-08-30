# Authoring tooling

## Purpose and scope

This specification defines the authoring tooling: the source format in which Archive material is authored, the compilation process that transforms source material into the compiled content model, the derivation of IDs and slugs, the controlled vocabularies, the compiled content format, and the property schema.

It governs:

- the semantically enriched Markdown source format;
- the compilation process and its observable properties;
- the derivation of document and block IDs from source file path and heading structure;
- the derivation of document slugs from titles;
- the controlled vocabulary of relationship types;
- the compiled content block format;
- the property schema, including filterable properties and match semantics.

It is explicitly out of scope for this specification to define:

- the content model — the structure, identity, metadata, and relationships of documents and content blocks — which is defined by [Content model](./content-model.spec.md);
- the retrieval interface — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- the constrained agent — which is defined by [Constrained agent](./constrained-agent.spec.md).

This specification defines how source material is authored and compiled; the content model defines what the compiled result must conform to. Where the content model defers a detail to this specification, this specification establishes it.

## Source format

Archive material is authored as semantically enriched Markdown. The source format extends ordinary Markdown with semantic annotations that express relationships, identify structural elements, and provide metadata for compilation.

### Documents as source files

Each document corresponds to a source file. A source file is a Markdown file containing the document's content organised as headings and body text.

- The source file's path within the Archive's content directory determines the document's identity, as defined in [ID derivation](#id-derivation).
- A source file must contain at least one heading, which becomes the root content block.

### Markdown structure and content blocks

Content blocks are markdown sections. A markdown section is the content under a heading, from that heading to the next heading of the same or higher level, or the end of the file.

- Each heading begins a new content block.
- The heading text becomes the block's title.
- The heading level determines the block's position in the containment hierarchy: a level-N heading is a child of the nearest preceding heading of level N-1 (or the root, if none).
- The body content under a heading — paragraphs, lists, code blocks, and other Markdown constructs — becomes the block's content.

The first heading in a source file is the document's root content block. Its title is the document's title, as defined by [Content model](./content-model.spec.md).

### Semantic annotations

Semantic annotations extend Markdown to express relationships and metadata. Annotations are expressed in a structured format within the source file.

#### Frontmatter

A source file may begin with a frontmatter block (YAML between `---` delimiters) containing document-level metadata. Frontmatter may include:

- author-declared metadata fields, which become document metadata as defined by [Content model](./content-model.spec.md);
- relationship declarations, as defined in [Relationship declarations](#relationship-declarations).

Frontmatter is optional. A source file without frontmatter is valid; the document's identity is derived from the file path, and metadata is limited to the required fields.

#### Relationship declarations

Relationships between content blocks are declared in the source material. A relationship declaration specifies:

- the source block (identified by its position in the document's heading structure);
- the relationship type (from the controlled vocabulary defined in [Controlled vocabularies](#controlled-vocabularies));
- the target block (identified by ID).

Relationship declarations may appear in frontmatter (for document-level or block-level relationships) or as inline annotations within a block's content. The specific syntax for relationship declarations is an implementation detail of the authoring tooling; this specification requires that:

- every relationship in the compiled model must be declared in the source material;
- the source-to-compiled mapping must be deterministic: the same source produces the same relationships;
- the declaration must identify the source block, type, and target unambiguously.

```markdown
---
title: Ceph Biology
relationships:
  - from: overview
    type: references
    to: ceph-tech:anatomy
---

# Overview

The Ceph are a diverse group...

## Anatomy

Their anatomy includes...
```

### Compilation

Source material is compiled into the content model by a compilation process. The compilation process uses custom remark plugins to parse the semantically enriched Markdown and produce compiled documents and content blocks.

- Compilation must produce documents and content blocks conforming to [Content model](./content-model.spec.md).
- Compilation must satisfy the compilation contract defined by [Content model](./content-model.spec.md): deterministic with respect to identity, slugs, containment, and relationships; rejection of unrecognised relationship types and unresolved targets.
- The specific remark plugins and their implementation are an implementation detail; this specification defines the observable properties of compilation, not the plugin internals.

### Content sources

Content sources may live in an external git repository, separate from the application codebase.

- The compilation process must be able to compile source material from an external repository.
- The specific mechanism by which the source repository is cloned, fetched, or synced is an implementation detail.

In the deployment defined by [Usage and deployment](./usage-and-deployment.spec.md#content-lifecycle), the backend is the component that accesses the external git repository, compiles the source on webhook, and writes the compiled model to a persistent store. A content-specific configuration file may live in the root of the content repository alongside the source Markdown, as defined in [Usage and deployment](./usage-and-deployment.spec.md#configuration); this specification governs the source format, not the configuration file format.

### Recompilation trigger

Recompilation is triggered when source files change. When content sources live in an external git repository, a webhook notifies the system of changes.

- A webhook notification of a change must trigger recompilation of the affected source files.
- Recompilation must produce a compiled model that conforms to [Content model](./content-model.spec.md), satisfying the compilation contract as if the source had been compiled from scratch.
- The specific webhook payload format and the mapping from webhook notification to affected files is an implementation detail; this specification requires that a webhook-triggered recompilation mechanism exists when content sources are external.

```gherkin
Feature: Recompilation trigger
  Rule: Webhook-triggered changes cause recompilation

  Scenario: Webhook triggers recompilation
    Given content sources live in an external git repository
    When a webhook notifies that source files have changed
    Then the affected source files must be recompiled
    And the compiled model must conform to Content model

  Scenario: Recompilation preserves identity for unchanged files
    Given a webhook notifies changes to file A
    And file B is unchanged
    When recompilation occurs
    Then file B's document and block IDs must not change
    And file B's content must not change
```

## ID derivation

Document and block IDs are derived from the source file path and heading structure. IDs are independent of content and title, as required by [Content model](./content-model.spec.md).

### Document IDs

A document's ID is derived from its source file path within the Archive's content directory.

- The ID is derived from the file's relative path, normalised (e.g. directory separators replaced, file extension removed).
- The ID is stable across compilations of the same file at the same path.
- The ID is independent of the file's content: renaming a heading or editing body text does not change the document ID.
- Moving the source file to a different path changes the document ID, since the path is the basis of the ID.

### Block IDs

A block's ID is derived from its document's ID and the block's position in the heading structure.

- The block ID incorporates the document ID and a structural identifier derived from the heading's position (e.g. heading path, slugified heading text at its position).
- The block ID is stable across compilations when the heading structure is unchanged: adding, removing, or reordering headings may change the structural identifiers of affected blocks.
- The block ID is independent of the heading's text content: editing a heading's text does not change the block ID, since the structural identifier is position-based, not text-based.

The specific normalisation and structural identifier scheme is an implementation detail; this specification requires that IDs are path/structure-derived, stable across recompilation of unchanged source, and independent of content and title.

```gherkin
Feature: ID derivation
  Rule: IDs are derived from file path and heading structure, independent of content

  Scenario: Document ID from file path
    Given a source file at content/ceph-biology/overview.md
    When the file is compiled
    Then the document ID must be derived from the path "ceph-biology/overview"
    And the ID must not depend on the file's content

  Scenario: Block ID from heading structure
    Given a document with headings "# Overview" and "## Anatomy"
    When the document is compiled
    Then the root block ID must be derived from the document ID and the first heading
    And the "Anatomy" block ID must be derived from the document ID and the second heading's position
    And editing the "Anatomy" heading text must not change the block ID

  Scenario: Content edit does not change IDs
    Given a document compiled from source file S
    When a body paragraph in S is edited
    Then the document ID must not change
    And all block IDs must not change
```

## Slug derivation

A document's slug is derived from its title (the title of its root block), as required by [Content model](./content-model.spec.md).

- The slug is produced by slugifying the document's title: normalising to a URL-safe form (lowercase, whitespace replaced with hyphens, non-alphanumeric characters removed or replaced).
- The slug is stable across compilations of unchanged source: the same title produces the same slug.
- The slug changes when the title changes: editing the root heading text changes the slug, but does not change the document ID (since the ID is path-derived).

### Slug uniqueness

Slugs must be unique within the Archive, as required by [Content model](./content-model.spec.md). When two documents would produce the same slug (e.g. two files with the same root heading text), the compilation must resolve the collision.

- The collision resolution policy is an implementation detail; this specification requires that the resulting slugs are unique and that the resolution is deterministic (the same source produces the same slugs).
- Collision resolution must not change document IDs.

## Controlled vocabularies

### Relationship types

The controlled vocabulary of relationship types is established by this specification. Relationship types must be drawn from this vocabulary, as required by [Content model](./content-model.spec.md).

The initial vocabulary is:

| Type             | Semantics                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `references`     | The source block refers to or cites the target block.                                         |
| `describes`      | The source block describes the target block's subject.                                        |
| `contrasts-with` | The source block contrasts its subject with the target block's subject.                       |
| `derived-from`   | The source block's content is derived from the target block's content.                        |
| `related-to`     | The source block is related to the target block in a way not covered by a more specific type. |

The vocabulary may be extended. Extensions must be established through the specification workflow; implementations must not admit relationship types outside the established vocabulary.

### Symmetric types

A relationship type may be declared symmetric, meaning that the reverse relationship is implied. No type in the initial vocabulary is symmetric; all relationships are directional and non-symmetric by default, as required by [Content model](./content-model.spec.md).

## Compiled content format

The compiled content block content is rendered Markdown text.

- The content field of a compiled content block is a string containing the Markdown text of the block's body — the content under the heading, excluding the heading itself.
- The Markdown text is the authored source text, processed by the remark pipeline (e.g. normalised, with semantic annotations stripped).
- The content is plain Markdown text, not an AST: the Guide and the User consume rendered Markdown.

This resolves the content format question deferred by [Content model](./content-model.spec.md).

## Property schema

The property schema defines the properties of documents and content blocks that are available for retrieval by properties, as defined by [Content-first retrieval](./content-first-retrieval.spec.md).

### Filterable properties

The following properties are filterable:

| Object        | Property | Match semantics     |
| ------------- | -------- | ------------------- |
| Document      | slug     | Exact               |
| Document      | title    | Substring           |
| Content block | title    | Substring           |
| Content block | document | Exact (document ID) |

- Filterable properties are indexed by the property index, as defined by [Content-first retrieval](./content-first-retrieval.spec.md).
- Retrieval by a property not in this table must be rejected, as required by [Content-first retrieval](./content-first-retrieval.spec.md).

The schema may be extended. Extensions must be established through the specification workflow.

### Non-filterable properties

The following properties are explicitly not filterable:

- `content` — block content is searchable via textual content retrieval, not by property matching;
- `relationships` — relationships are traversed via relationship traversal, not by property matching;
- `children` — containment is traversed via the containment index, not by property matching;
- `parent` — containment is traversed via the containment index, not by property matching.

## VS Code extension

A VS Code extension supports authoring. The extension provides authoring assistance for the semantically enriched Markdown source format. The specific capabilities and implementation of the extension are an implementation detail.

## Conformance

An implementation conforms to this specification when:

- source material is authored as semantically enriched Markdown, with documents as source files and content blocks as markdown sections;
- relationships are declared in source material and compiled into typed relationships conforming to [Content model](./content-model.spec.md);
- compilation produces documents and content blocks conforming to [Content model](./content-model.spec.md), satisfying its compilation contract;
- content sources may live in an external git repository, and webhook-triggered recompilation occurs when source files change;
- document IDs are derived from source file paths and are independent of content;
- block IDs are derived from document IDs and heading structure and are independent of heading text;
- document slugs are derived from titles by slugification, are unique, and change when the title changes;
- relationship types are drawn from the controlled vocabulary, and unrecognised types are rejected;
- compiled block content is rendered Markdown text;
- the property schema defines the filterable properties and their match semantics, and non-filterable properties are rejected.
