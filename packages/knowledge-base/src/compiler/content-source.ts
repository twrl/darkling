/**
 * Content source abstraction — the mechanism by which the compiler obtains
 * source material. Platform-neutral.
 *
 * @see specs/authoring-tooling.spec.md#content-sources
 */

/**
 * A content source provides the compiler with the Markdown text of source
 * files and the list of source file paths within the content directory.
 *
 * Implementations:
 * - `StaticContentSource` — constructed from a map of path → content, for
 *   testing and in-memory compilation.
 * - A Node.js implementation would read from the filesystem.
 * - A browser implementation would fetch over HTTP.
 * - An external-git-repository implementation would read from a cloned working copy.
 */
export interface ContentSource {
  /** List the relative paths of source files within the content directory. */
  list(): Promise<string[]>;
  /** Read the Markdown text of a source file by its relative path. */
  read(path: string): Promise<string>;
}

/**
 * A content source backed by an in-memory map of path → content. Used for
 * testing and for in-memory compilation.
 */
export class StaticContentSource implements ContentSource {
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string> | Map<string, string>) {
    this.files = files instanceof Map ? files : new Map(Object.entries(files));
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`Source file not found: ${path}`);
    }
    return content;
  }
}
