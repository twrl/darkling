# Journal: Annotations

This journal records the development of [annotations.spec.md](./annotations.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created as the seventh specification, in response to a request to establish the annotations spec referenced by the three-way interaction, content model, and constrained agent specs. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Model + authoring/lifecycle.** The spec covers the annotation model (structure, attachment, topic-linking, personality relationship), the authoring and lifecycle (source authoring, compilation, update, removal), and the Guide's access mechanism. This is comprehensive rather than model-only.
- **Authored content.** Annotations are authored content, compiled alongside content blocks — not runtime-created by the Guide. This is consistent with the README's description of annotations as authored material giving the Guide "opinions and affective cues," and with the Guide's personality being "authored." The Guide does not create annotations at runtime; that's what working memory is for.
- **Via retrieval tools.** Annotations are accessed through the knowledge base access tool category — the same retrieval interface as content blocks. This keeps the Guide's access to annotations within the constrained agent's tool-call discipline: annotations are retrieved via tool calls, not provided automatically in the status object.

## Key decisions and rationale

### Document-level annotations in frontmatter, retrieved as document metadata

The initial draft had annotations attaching to specific content blocks, with three separate retrieval modes (by attachment target, by topic, by ID). The user simplified this: annotations are authored as frontmatter on the document's source file, attach to the document as a whole (not to specific blocks), and are retrieved as metadata on the document. This means:

- **Authoring** — annotations are frontmatter fields on the source file, alongside other document metadata. No separate syntax or inline annotations.
- **Attachment** — implicit: the annotation belongs to the document whose source file contains it. No block-level targeting, no attachment target field, no unresolved-attachment rejection.
- **Retrieval** — annotations come back as an `annotations` array on the document result. No separate annotation retrieval modes. The Guide retrieves a document and gets its annotations as metadata. Topic-based retrieval is a property-based query on documents (find documents with annotations on a given topic).

This is a significant simplification: fewer concepts (no block-level attachment, no separate retrieval modes), fewer failure modes (no unresolved attachments), and a cleaner authoring experience (frontmatter is already where document metadata lives). The trade-off is that annotations can't target specific blocks within a document — they're the Guide's perspective on the document as a whole. This is acceptable given that the Guide's subjective perspective is broader than individual blocks.

### Annotations are authored, not runtime-generated

The user chose authored content over runtime-created. This means the Guide's opinions, recollections, and affective cues are established by the author in source material, not invented by the model at runtime. This is consistent with the README's framing of the Guide as having "a strong authored personality" and "private, topic-linked notes and recollections." It also keeps the Guide's subjective perspective stable and intentional rather than emergent and potentially inconsistent.

This distinguishes annotations from working memory (which is runtime-mutable via `update_working_memory`). Annotations are the authored source of the Guide's personality; working memory is the Guide's runtime state. The constrained agent spec already notes this distinction; this spec makes it normative.

### Annotations attach to documents, not blocks

Annotations attach to the document as a whole, authored in document frontmatter. This is simpler than block-level attachment and matches the authoring model: frontmatter is document-level metadata. The Guide's perspective is on the document, not on individual sections within it. Block-level targeting was considered but rejected as unnecessary complexity.

### Topic is free-form, not controlled vocabulary

Unlike relationship types (which are a controlled vocabulary), annotation topics are free-form labels. This is deliberate: the Guide's subjective perspective organises itself around themes that may not correspond to the Archive's formal structure. A controlled vocabulary would impose the Archive's ontology on the Guide's private notes, which would be inappropriate — the Guide's perspective is explicitly not the Archive's perspective.

### Annotations are private, not shown to the User

Annotations are retrieved by the Guide and used in reasoning, but are not shown directly to the User. The Guide may express the content of an annotation in its responses (through avatar interaction tools), but the annotation itself is not displayed. This preserves the distinction between the Guide's private perspective and the User's view of the Archive.

### Retrieved as document metadata

Annotations are included as metadata on document retrieval results. When the Guide retrieves a document, it gets the document's annotations alongside the document's other metadata. This means there is no separate annotation retrieval cost — the annotations come with the document. Topic-based retrieval is a property query on documents (find documents with annotations on a given topic), which returns documents with their annotations included.

This is simpler than the initial draft's three separate retrieval modes (by attachment target, by topic, by ID) and means the Guide always has the Guide's perspective on a document when it retrieves that document. The trade-off is that the Guide can't retrieve a single annotation by ID in isolation, but this was not a likely access pattern.

### Annotation IDs independent of content

Like content block IDs, annotation IDs are independent of content: editing an annotation's text does not change its ID. This is consistent with the content model's identity principle and ensures annotation references remain stable across content edits.

## Dependencies on not-yet-established specifications

This specification references the authoring tooling spec for the source format and compilation process. The authoring tooling spec is now established as [authoring-tooling.spec.md](./authoring-tooling.spec.md), but it does not currently define the annotation authoring syntax. The annotations spec requires that annotations are authored in source material with a syntax that identifies the attachment target, topic, and affective tone, but leaves the specific syntax to implementation. When the authoring tooling spec is next revised, it should be updated to define the annotation authoring syntax or confirm that it is left to implementation.

## Gaps and ambiguities

- **Annotation frontmatter syntax.** The spec requires annotations to be authored in frontmatter and gives an illustrative example, but leaves the specific frontmatter structure to implementation. The authoring tooling spec should be updated to define the annotation frontmatter syntax or confirm it is implementation-defined.
- **Annotation ID derivation.** The spec requires stable IDs independent of content but does not prescribe the derivation scheme. This is left to implementation, consistent with how content block ID derivation is handled.
- **Annotation storage and indexing.** The spec defines that annotations are included as document metadata and that topic-based retrieval is a property query on documents, but does not specify how annotations are indexed for topic-based retrieval. This may need to be added to the content-first retrieval spec's property index.
- **Affective tone vocabulary.** The affective tone is a free-form label, not a controlled vocabulary. This is deliberate (matching the free-form topic approach) but may lead to inconsistent tone labelling. A controlled vocabulary for tones may be warranted in future.
- **Multiple annotations on the same document.** The spec permits multiple annotations on a single document but does not define ordering. The order of annotations in the document result's `annotations` array is undefined.
- **Annotation content format.** The spec defines annotation content as text but does not specify whether it is plain text, Markdown, or another format. Given that content block content is Markdown text, annotations may follow the same convention, but this is not stated.
- **Annotation relationships.** The spec does not address whether annotations may have relationships to other annotations or to content blocks. This is left to future specification if needed.
- **Document data contract extension.** The spec states that the document data contract is extended to include an `annotations` array, but the content model's document data contract does not currently include this field. The content model spec should be updated to reference this spec for the annotations field, or the field should be added to the content model's data contract.
