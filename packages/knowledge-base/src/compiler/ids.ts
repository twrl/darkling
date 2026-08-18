/**
 * ID and slug derivation, as defined by
 * [ID derivation](../../specs/authoring-tooling.spec.md#id-derivation) and
 * [Slug derivation](../../specs/authoring-tooling.spec.md#slug-derivation).
 *
 * @see specs/authoring-tooling.spec.md#id-derivation
 */

import {
  asBlockId,
  asDocumentId,
  asSlug,
  type BlockId,
  type DocumentId,
  type Slug,
} from '../model.js';

/**
 * Derive a document ID from its source file path within the content directory.
 *
 * The scheme: the file's relative path, with the file extension removed,
 * lowercased, and each path segment slugified. e.g. `ceph-biology/overview.md`
 * → `ceph-biology/overview`. This is path-derived (independent of content) and
 * stable across recompilation of unchanged source.
 *
 * @see specs/authoring-tooling.spec.md#id-derivation
 */
export const deriveDocumentId = (relativePath: string): DocumentId => {
  const withoutExt = relativePath.replace(/\.[^./]+$/, '');
  const segments = withoutExt.split('/').map(slugifySegment);
  return asDocumentId(segments.join('/'));
};

/**
 * Derive a block ID from its document ID and heading path.
 *
 * The heading path is the sequence of heading positions (1-indexed among
 * siblings at each level) joined by `.`. e.g. the first H2 under the first H1
 * is `1.1`. The block ID is `documentId:headingPath`. This is position-based
 * (independent of heading text) and stable when the heading structure is unchanged.
 */
export const deriveBlockId = (documentId: DocumentId, headingPath: string): BlockId =>
  asBlockId(`${documentId}:${headingPath}`);

/**
 * Slugify a document title to a URL-safe slug.
 *
 * Lowercase, whitespace → hyphens, non-alphanumeric characters removed (except
 * hyphens), leading/trailing hyphens stripped.
 *
 * @see specs/authoring-tooling.spec.md#slug-derivation
 */
export const slugify = (title: string): Slug => asSlug(slugifySegment(title));

/**
 * Slugify a single path segment or title.
 */
const slugifySegment = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Resolve slug collisions deterministically. Given a list of (documentId, slug)
 * pairs, returns a map from documentId to a unique slug. On collision, appends
 * `-2`, `-3`, etc. to subsequent documents in document-ID order. Collision
 * resolution does not change document IDs.
 *
 * @see specs/authoring-tooling.spec.md#slug-uniqueness
 */
export const resolveSlugCollisions = (
  entries: Array<{ documentId: DocumentId; slug: Slug }>,
): Map<DocumentId, Slug> => {
  const seen = new Map<string, number>();
  const result = new Map<DocumentId, Slug>();
  const sorted = [...entries].sort((a, b) => a.documentId.localeCompare(b.documentId));
  for (const { documentId, slug } of sorted) {
    const key = String(slug);
    const count = seen.get(key) ?? 0;
    if (count === 0) {
      result.set(documentId, slug);
    } else {
      result.set(documentId, asSlug(`${key}-${count + 1}`));
    }
    seen.set(key, count + 1);
  }
  return result;
};
