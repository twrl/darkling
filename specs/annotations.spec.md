# Annotations

## Purpose and scope

This specification defines the annotation model: the Guide's private, topic-linked notes and recollections, represented as annotations on Archive documents. Annotations are authored content that gives the Guide opinions, affective cues, and private recollections without making its subjective perspective part of the Archive's underlying record.

It governs:

- the structure and identity of annotations;
- the attachment of annotations to documents;
- topic-linking of annotations;
- the relationship between annotations and the Guide's personality;
- the authoring and lifecycle of annotations;
- compilation of annotations alongside documents;
- the Guide's access to annotations as document metadata.

It is explicitly out of scope for this specification to define:

- the content model — documents, content blocks, and relationships — which is defined by [Content model](./content-model.spec.md);
- the retrieval interface — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- the constrained agent's tool-call discipline, working memory, and budget — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the three-way interaction model — which is defined by [Three-way interaction](./three-way-interaction.spec.md);
- the authoring format and compilation tooling for content blocks — which is defined by [Authoring tooling](./authoring-tooling.spec.md).

It is explicitly out of scope for this specification to define:

- the content model — documents, content blocks, and relationships — which is defined by [Content model](./content-model.spec.md);
- the retrieval interface — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- the constrained agent's tool-call discipline, working memory, and budget — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the three-way interaction model — which is defined by [Three-way interaction](./three-way-interaction.spec.md);
- the authoring format and compilation tooling for content blocks — which is defined by [Authoring tooling](./authoring-tooling.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Design context

The Guide has a strong authored personality and access to private, topic-linked notes and recollections. These are represented as annotations on Archive content rather than as mutable model memory, allowing the Guide to have opinions and affective cues without making its subjective perspective part of the Archive's underlying record.

Annotations are the mechanism by which the Guide's subjective perspective is authored and made available. They are distinct from:

- **working memory** — the Guide's mutable, cross-interaction JSON state, as defined by [Constrained agent](./constrained-agent.spec.md). Working memory is runtime state; annotations are authored content.
- **Archive content** — the documents and content blocks that form the Archive's record. Annotations are attached to documents as metadata but are not part of the Archive's record.
- **relationships** — the typed semantic links between content blocks, as defined by [Content model](./content-model.spec.md). Annotations are metadata on documents, not links between blocks.

## Annotations

An annotation is the Guide's private note or recollection attached to a document. Annotations are authored content, compiled alongside the Archive's documents.

### Structure

An annotation consists of:

- a unique ID;
- a topic — a label linking the annotation to a topic, enabling topic-linked retrieval;
- content — the text of the annotation: the Guide's note, opinion, recollection, or affective cue;
- an affective tone (optional) — a label describing the emotional or attitudinal character of the annotation (e.g. "wry", "nostalgic", "dismissive").

### Identity

Each annotation must have a stable, unique identifier (its ID).

- An annotation's ID must be stable across compilations of the same source material.
- An annotation's ID must uniquely identify the annotation within the Archive.
- An annotation's ID must be independent of its content: editing an annotation's text must not change its ID.

### Attachment

An annotation attaches to a single document.

- The attachment is to the document as a whole, not to a specific content block within it.
- A document may have zero, one, or many annotations.
- An annotation's attachment is to one document only; an annotation must not attach to multiple documents.
- Annotations are compiled as metadata on the document, as defined in [Compilation](#compilation).

### Topic-linking

Each annotation has a topic — a label that links it to a subject or theme.

- The topic is a free-form label, not drawn from a controlled vocabulary. This allows the Guide's subjective perspective to organise itself around themes that may not correspond to the Archive's formal structure.
- Topic-linking enables the Guide to retrieve annotations by topic, as defined in [Guide access](#guide-access).
- Multiple annotations may share a topic; a single annotation has one topic.

### Relationship to the Guide's personality

Annotations carry the Guide's subjective perspective: opinions, affective cues, and private recollections. They are the authored source of the Guide's personality and voice.

- Annotations are authored content, not runtime-generated. The Guide's opinions and recollections are established by the author, not invented by the model at runtime.
- The Guide may express the content of an annotation in its responses, but the annotation itself is private: it is not shown to the User as Archive content. The Guide's response is its own; the annotation is the source material behind it.
- Annotations are not part of the Archive's record. A User reading the Archive does not see annotations; only the Guide has access to them.

## Authoring and lifecycle

### Authoring

Annotations are authored as frontmatter on the document's source file, alongside other document-level metadata.

- Annotations are authored in the frontmatter of the semantically enriched Markdown source file defined by [Authoring tooling](./authoring-tooling.spec.md).
- An annotation is authored as a frontmatter field associated with the document. The specific frontmatter structure for annotations is an implementation detail of the authoring tooling; this specification requires that:
  - every annotation must be authored in the source file's frontmatter;
  - the authoring syntax must specify the topic and optional affective tone;
  - the source-to-compiled mapping must be deterministic.

```markdown
---
annotations:
  - topic: cephalopod-history
    tone: nostalgic
    content: 'I remember when the Ceph were first catalogued...'
  - topic: ceph-biology
    content: "The author overstates the Ceph's regenerative abilities."
---

# Ceph Biology

The Ceph are a diverse group...
```

### Lifecycle

Annotations follow the same compilation lifecycle as documents:

- **Compilation** — annotations are compiled alongside documents, as defined in [Compilation](#compilation).
- **Update** — editing an annotation's source text and recompiling updates the annotation. The annotation's ID must not change, since IDs are independent of content.
- **Removal** — removing an annotation from the frontmatter and recompiling removes it from the compiled model.

Annotations are immutable at runtime. The Guide does not create, edit, or delete annotations through tool calls; annotations are authored content, not runtime state. This distinguishes annotations from working memory, which the Guide may modify at runtime via `update_working_memory`, as defined by [Constrained agent](./constrained-agent.spec.md).

## Compilation

Annotations are compiled alongside documents by the compilation process defined by [Authoring tooling](./authoring-tooling.spec.md).

- Compilation must produce annotations conforming to the structure defined in [Structure](#structure).
- Compilation must assign each annotation a stable ID, independent of its content.
- Compilation must attach each annotation to the document whose source file contains it. Since annotations are authored in document frontmatter, the attachment is implicit: the annotation belongs to the document.
- Compilation must preserve the annotation's topic and affective tone (if specified).
- Compilation must be deterministic with respect to annotation identity, topic, and content: the same source produces the same annotations.
- Compiled annotations must be included as metadata on the document, as defined in [Guide access](#guide-access).

```gherkin
Feature: Annotation compilation
  Rule: Annotations are compiled from frontmatter as document metadata with stable IDs

  Scenario: Compiling annotations from frontmatter
    Given source file content/ceph-biology/overview.md has frontmatter with two annotations
    When the source material is compiled
    Then both annotations must be included in the compiled model
    And both annotations must be attached to the document compiled from that file
    And each annotation must have a stable ID

  Scenario: Content edit does not change annotation ID
    Given an annotation with ID "note-1" and content C
    When the annotation's source text is changed to C'
    Then the annotation's ID must remain "note-1"
```

## Guide access

The Guide accesses annotations as metadata attached to documents. When the Guide retrieves a document, its annotations are included in the document's metadata.

### Document retrieval includes annotations

When the Guide retrieves a document — by ID, by slug, or by properties, as defined by [Content-first retrieval](./content-first-retrieval.spec.md) — the document result must include the document's annotations as metadata.

- Annotations are included as a field on the document result, not as separate objects requiring a second retrieval.
- A document with no annotations has an empty annotations array.

### Annotation result shape

Each annotation in a document's metadata includes:

- the annotation's ID;
- the annotation's topic;
- the annotation's affective tone (if specified);
- the annotation's content.

The attachment is implicit: the annotation is metadata on the document that was retrieved, so no separate attachment target field is needed.

### Topic-based retrieval

The Guide may retrieve documents by annotation topic. This is a property-based retrieval on the document's annotations, as defined by [Content-first retrieval](./content-first-retrieval.spec.md).

- **Parameters** — a topic label.
- **Result** — documents that have at least one annotation with the specified topic, with their annotations included as metadata.

### Visibility

Annotations are not visible to the User. They are metadata included in document retrieval results for the Guide's use in reasoning and response, and do not produce a visible interface change, as defined by [Constrained agent](./constrained-agent.spec.md). The Guide may express the content of an annotation in its responses through avatar interaction tools, but the annotation itself is not shown directly.

```gherkin
Feature: Guide access to annotations
  Rule: Annotations are retrieved as document metadata

  Scenario: Document retrieval includes annotations
    Given document "ceph-biology" has two annotations
    When the Guide retrieves document "ceph-biology" by slug
    Then the document result must include both annotations as metadata
    And the interface must not change

  Scenario: Retrieving documents by annotation topic
    Given documents "ceph-biology" and "ceph-tech" both have annotations with topic "cephalopod-history"
    When the Guide retrieves documents by annotation topic "cephalopod-history"
    Then both documents must be returned
    And each document's annotations must be included as metadata
    And the interface must not change
```

## Data contract

The following JSON Schema describes the minimal data contract of a compiled annotation. Extensions may add fields but must not remove or repurpose the fields defined here.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Annotation",
  "type": "object",
  "required": ["id", "topic", "content"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable, unique identifier for the annotation."
    },
    "topic": {
      "type": "string",
      "description": "Free-form topic label linking the annotation to a subject."
    },
    "affectiveTone": {
      "type": "string",
      "description": "Optional label describing the emotional or attitudinal character."
    },
    "content": {
      "type": "string",
      "description": "The text of the annotation."
    }
  }
}
```

Annotations are included as an `annotations` array on the document result, as defined by [Content-first retrieval](./content-first-retrieval.spec.md). The document data contract is extended by this specification to include this array.

## Conformance

An implementation conforms to this specification when:

- annotations are authored as frontmatter on document source files and compiled alongside documents;
- each annotation has a stable, unique ID that is independent of its content;
- each annotation attaches to the document whose source file contains it;
- each annotation has a topic and optional affective tone;
- annotations are immutable at runtime; the Guide does not create, edit, or delete them through tool calls;
- annotations are not visible to the User and are not part of the Archive's record;
- document retrieval results include the document's annotations as metadata;
- the Guide may retrieve documents by annotation topic;
- compilation is deterministic with respect to annotation identity, topic, and content.
