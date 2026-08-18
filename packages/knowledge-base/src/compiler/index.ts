/**
 * @darkling/knowledge-base/compiler — the compilation pipeline that transforms
 * authored semantically enriched Markdown into the compiled content model.
 *
 * @see specs/authoring-tooling.spec.md
 */

export type { ContentSource } from './content-source.js';
export { StaticContentSource } from './content-source.js';

export { compile, Compiler, type CompilerOptions } from './compiler.js';
export type { CompiledModel, CompilationReport } from '../model.js';

export { DEFAULT_RELATIONSHIP_TYPES } from './vocabulary.js';

export { deriveBlockId, deriveDocumentId, resolveSlugCollisions, slugify } from './ids.js';
