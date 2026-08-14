# Journal: Authoring tooling

This journal records the development of [authoring-tooling.spec.md](./authoring-tooling.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created as the sixth specification, in response to a request to establish the authoring tooling spec referenced by the content model and content-first retrieval specs. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Source format: defined.** The spec defines the semantically enriched Markdown source format normatively: documents as source files, content blocks as markdown sections (heading-delimited), frontmatter for metadata and relationships, and relationship declarations. The specific syntax for relationship declarations is left to implementation, but the requirements (deterministic mapping, unambiguous identification of source/type/target) are normative.
- **Content format: Markdown text.** The compiled block content is rendered Markdown text (a string), not mdast. This resolves the content format gap deferred from the content model spec. The Guide and User consume rendered Markdown.
- **ID scheme: path/structure-derived.** Document IDs are derived from the source file path; block IDs from the document ID plus heading structure position. IDs are independent of content and title (content edits don't change IDs; moving a file does change the document ID). This resolves the ID derivation gap from the content model spec.
- **VS Code extension: mention only.** The spec states that a VS Code extension exists and provides authoring assistance, but leaves the specific capabilities to implementation.

### External content sources and webhook-triggered recompilation

The user specified that content sources may live in an external git repository, and a webhook triggers recompilation when files change. The spec now requires that compilation can read from an external repository, a webhook-triggered recompilation mechanism exists when sources are external, and recompilation produces a conformant compiled model. Unchanged files are not affected by recompilation of other files. The specific webhook payload, repository sync mechanism, and webhook-to-file mapping are left to implementation.

## Key decisions and rationale

### Documents as source files, blocks as markdown sections

The mapping is clean: one source file = one document; each heading = one content block; heading level = containment hierarchy depth. This makes the source format immediately legible to authors familiar with Markdown, and the containment hierarchy emerges naturally from heading structure without explicit parent/child declarations.

### Path-derived document IDs, structure-derived block IDs

The user chose path/structure-derived IDs over author-assigned IDs. This means:

- Document IDs come from the file path (normalised). Moving a file changes the ID; editing content doesn't.
- Block IDs come from the document ID plus heading position. Reordering headings may change block IDs; editing heading text doesn't (position-based, not text-based).

This satisfies the content model's requirement that IDs are independent of content and title. The trade-off is that file moves and heading restructures are identity-changing operations, which is appropriate — they are structural changes, not content edits.

### Slug from title, ID from path

The deliberate asymmetry (from the content model spec) is preserved: the slug is content-derived (from the title) and may change when the title changes; the ID is path-derived and stable across content edits. This means humans see slugs that reflect the current title, while the system references IDs that don't break on content edits.

### Slug collision resolution

The spec requires unique slugs and deterministic collision resolution but leaves the specific policy to implementation. This could be path-based disambiguation, numeric suffixes, or another scheme. The key constraint is that collision resolution must not change document IDs.

### Relationship types vocabulary

The initial vocabulary has five types: references, describes, contrasts-with, derived-from, related-to. These are drawn from the README's examples and the content model spec's examples. The vocabulary is extensible via the specification workflow. No type is symmetric by default, consistent with the content model's directionality requirement.

### Content is Markdown text, not mdast

The user chose Markdown text over mdast. This is simpler for the Guide to consume (the model reads text, not ASTs) and for the User to see (rendered Markdown). The trade-off is that programmatic structure traversal of content is not possible from the compiled form, but the content model's containment hierarchy and relationships provide structure separately. The remark pipeline processes the source (normalising, stripping semantic annotations) before producing the content string.

### Property schema with filterable/non-filterable distinction

The spec defines four filterable properties (document slug, document title, block title, block document) with match semantics, and explicitly lists non-filterable properties (content, relationships, children, parent). This resolves the property schema gap from the content-first retrieval spec. Content is searchable via text search, not property matching; relationships and containment are traversed via their respective indexes.

## Gaps and ambiguities

- **Relationship declaration syntax.** The spec requires that relationships are declared in source but leaves the specific syntax (frontmatter YAML, inline annotations, or both) to implementation. The example shows frontmatter YAML, but this is illustrative.
- **Block ID structural identifier scheme.** The spec says block IDs incorporate the document ID and a structural identifier from heading position, but doesn't prescribe the exact scheme (e.g. slugified heading path, ordinal index, hash of position). This is left to implementation.
- **Slug collision resolution policy.** The spec requires deterministic, uniqueness-preserving resolution but doesn't prescribe the method.
- **Slugification rules.** The spec describes slugification in general terms (lowercase, hyphens, remove/replace non-alphanumeric) but doesn't prescribe the exact rules (e.g. handling of Unicode, consecutive hyphens, leading/trailing hyphens).
- **Remark pipeline details.** The spec says the remark pipeline processes source (normalising, stripping annotations) but doesn't define the specific transformations.
- **Document metadata fields.** The spec allows author-declared metadata in frontmatter but doesn't enumerate the fields beyond the content model's required minimum. The set of supported metadata fields is left to implementation.
- **Vocabulary extension process.** The spec says extensions must go through the specification workflow but doesn't define a versioning or migration strategy for existing content when the vocabulary changes.
- **Heading restructure semantics.** The spec notes that reordering headings may change block IDs but doesn't define the exact conditions under which a block ID changes vs. persists during structural edits.
