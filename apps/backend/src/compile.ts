/**
 * Compilation: compiles source Markdown into the persistent store, triggered by
 * webhook. The initial implementation uses a filesystem `ContentSource` rooted
 * at a configured directory (the git working copy the backend accesses).
 *
 * @see specs/usage-and-deployment.spec.md#content-sources-and-publishing-workflows
 * @see specs/authoring-tooling.spec.md
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ContentSource, CompiledModel } from '@darkling/knowledge-base/compiler';
import { Compiler } from '@darkling/knowledge-base/compiler';

import type { PersistentStore } from './store.js';

/** A filesystem `ContentSource`, reading Markdown from a rooted directory. */
export class FilesystemContentSource implements ContentSource {
  constructor(private readonly rootPath: string) {}

  async list(): Promise<string[]> {
    const entries = await this.walk(this.rootPath);
    return entries
      .filter((p) => p.endsWith('.md') || p.endsWith('.markdown'))
      .map((p) => relative(this.rootPath, p));
  }

  async read(path: string): Promise<string> {
    return readFile(join(this.rootPath, path), 'utf8');
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.walk(full)));
      } else {
        results.push(full);
      }
    }
    return results;
  }
}

/**
 * Compile the content source into the persistent store.
 * Returns the compiled model.
 */
export async function compileIntoStore(
  source: ContentSource,
  store: PersistentStore,
): Promise<CompiledModel> {
  const compiler = new Compiler(source);
  const model = await compiler.compile();
  store.load(model);
  return model;
}
