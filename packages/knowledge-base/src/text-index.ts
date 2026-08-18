/**
 * Text index — supports retrieval by textual content. Indexes the textual
 * content of all content blocks and supports relevance-ranked search.
 *
 * The in-memory implementation is a linear scan stub, ranked by a simple
 * term-frequency score. A real inverted or vector index (or a Redis/Upstash
 * implementation) can be substituted via the `TextIndex` interface.
 *
 * @see specs/content-first-retrieval.spec.md#storage-and-indexing
 */

import type { CompiledModel, ContentBlock, Document, BlockId, DocumentId } from './model.js';

/**
 * A ranked text search hit: a block ID and its relevance score.
 */
export interface TextHit {
  blockId: BlockId;
  score: number;
}

/**
 * The text index interface. Platform-neutral; an in-memory reference
 * implementation is provided by `InMemoryTextIndex`.
 */
export interface TextIndex {
  search(query: string): TextHit[];
  bulkLoad(model: CompiledModel): void;
}

/**
 * In-memory text index — a linear scan over all block content, ranked by a
 * simple term-frequency score. This is a stub for testing and bootstrap; the
 * `TextIndex` interface allows a real inverted or vector index to be
 * substituted without changing the retrieval engine.
 */
export class InMemoryTextIndex implements TextIndex {
  private blocks: ContentBlock[] = [];

  bulkLoad(model: CompiledModel): void {
    this.blocks = [...model.blocks];
  }

  search(query: string): TextHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const hits: TextHit[] = [];
    for (const block of this.blocks) {
      const contentTokens = tokenize(block.content + ' ' + block.title);
      let score = 0;
      for (const term of terms) {
        for (const token of contentTokens) {
          if (token.includes(term)) score += 1;
        }
      }
      if (score > 0) hits.push({ blockId: block.id, score });
    }
    hits.sort((a, b) => b.score - a.score || a.blockId.localeCompare(b.blockId));
    return hits;
  }
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 0);

/** Re-exported for the retrieval engine. */
export type { Document, DocumentId };
