/**
 * Compiled content model types — documents and content blocks.
 *
 * @see specs/content-model.spec.md
 */

/**
 * A stable, unique identifier for a document within the Archive.
 *
 * A document's ID must be stable across compilations of the same source
 * material, unique within the Archive, and independent of its content and
 * title, as defined by [Document identity](../../specs/content-model.spec.md#identity-and-addressability).
 */
export type DocumentId = string & { readonly __brand: 'DocumentId' };

/**
 * A stable, unique, human-readable slug for a document.
 *
 * Derived from the document's root block title, as defined by
 * [Document identity](../../specs/content-model.spec.md#identity-and-addressability).
 */
export type Slug = string & { readonly __brand: 'Slug' };

/**
 * A stable, unique identifier for a content block within the Archive.
 *
 * A block's ID must be stable across compilations of the same source
 * material, unique within the Archive, and independent of its content and
 * title, as defined by [Block identity](../../specs/content-model.spec.md#identity-and-addressability).
 */
export type BlockId = string & { readonly __brand: 'BlockId' };

/**
 * The controlled vocabulary of relationship types, as established by
 * [Controlled vocabularies](../../specs/authoring-tooling.spec.md#controlled-vocabularies).
 *
 * The vocabulary may be extended through the specification workflow; this
 * union reflects the initial vocabulary.
 */
export const RELATIONSHIP_TYPES = [
  'references',
  'describes',
  'contrasts-with',
  'derived-from',
  'related-to',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/**
 * A typed, directional relationship between content blocks.
 *
 * Relationships are directional: each has a source block (the block on which
 * the relationship is recorded), a type, and a target block. The reverse of a
 * relationship is a distinct, separately asserted relationship unless the type
 * is explicitly defined as symmetric (no initial type is symmetric).
 *
 * @see specs/content-model.spec.md#typed-relationships
 */
export interface Relationship {
  /** The relationship type, from the controlled vocabulary. */
  type: RelationshipType;
  /** The ID of the target block. */
  target: BlockId;
}

/**
 * A compiled document — a unit of Archive material.
 *
 * A document references exactly one root content block. Its title is the title
 * of its root block; its slug is derived from that title. Additional metadata
 * may be present; the fields here are the lower bound required by
 * [Content model](../../specs/content-model.spec.md).
 *
 * Annotations are opaque metadata (`unknown[]`); this package does not model
 * the annotation structure, as defined by [package.spec.md](./package.spec.md#annotations).
 *
 * @see specs/content-model.spec.md#documents
 */
export interface Document {
  /** Stable, unique identifier for the document. */
  id: DocumentId;
  /** Stable, unique, human-readable slug for the document. */
  slug: Slug;
  /** ID of the document's root content block. */
  rootBlock: BlockId;
  /**
   * The document's annotations, as opaque metadata. The package does not model
   * the annotation structure; see [Annotations](../../specs/annotations.spec.md).
   */
  annotations: unknown[];
  /**
   * Additional document metadata beyond the required minimum. The required
   * fields (id, slug, rootBlock, annotations) are the lower bound established
   * by [Content model](../../specs/content-model.spec.md#metadata).
   */
  metadata?: Record<string, unknown>;
}

/**
 * A compiled content block — a markdown section within a document.
 *
 * @see specs/content-model.spec.md#content-blocks
 */
export interface ContentBlock {
  /** Stable, unique identifier for the block. */
  id: BlockId;
  /** Human-readable title (the heading text). */
  title: string;
  /** ID of the containing document. */
  document: DocumentId;
  /** ID of the parent block, or null for a root block. */
  parent: BlockId | null;
  /**
   * Rendered Markdown text of the block's body — the content under the
   * heading, excluding the heading itself, with semantic annotations stripped.
   *
   * @see specs/authoring-tooling.spec.md#compiled-content-format
   */
  content: string;
  /** IDs of child blocks, in order. */
  children: BlockId[];
  /** Typed, directional relationships from this block. */
  relationships: Relationship[];
}

/**
 * The result of compiling source material: the documents and content blocks
 * of the compiled model, together with a compilation report.
 */
export interface CompiledModel {
  documents: Document[];
  blocks: ContentBlock[];
  report: CompilationReport;
}

/**
 * A report of rejections that occurred during compilation.
 *
 * @see specs/content-model.spec.md#compilation-contract — compilation must
 * report rejected relationship types and unresolved targets.
 */
export interface CompilationReport {
  /** Relationships rejected because their type is not in the controlled vocabulary. */
  rejectedUnknownTypes: Array<{ source: BlockId; type: string; target: string }>;
  /** Relationships rejected because their target does not resolve to a block. */
  rejectedUnresolvedTargets: Array<{ source: BlockId; type: RelationshipType; target: string }>;
}

/**
 * Branded-type constructors. These are intentionally permissive: any string
 * can be branded at runtime, since IDs are derived from source material and
 * are consumed as strings over the service bus. The brands exist to keep IDs
 * distinct at the type level to avoid confusion with arbitrary strings.
 */
export const asDocumentId = (value: string): DocumentId => value as DocumentId;
export const asBlockId = (value: string): BlockId => value as BlockId;
export const asSlug = (value: string): Slug => value as Slug;

/**
 * Type guard for the relationship type controlled vocabulary.
 */
export const isRelationshipType = (value: string): value is RelationshipType =>
  (RELATIONSHIP_TYPES as readonly string[]).includes(value);
