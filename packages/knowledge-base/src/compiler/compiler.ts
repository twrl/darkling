/**
 * Compiler — compiles semantically enriched Markdown source material into the
 * compiled content model, as defined by
 * [Authoring tooling](../../specs/authoring-tooling.spec.md).
 *
 * @see specs/authoring-tooling.spec.md#compilation
 */

import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkStringify from 'remark-stringify';
import type { Root, Heading, Content, Yaml } from 'mdast';
import type {
  BlockId,
  CompilationReport,
  CompiledModel,
  ContentBlock,
  Document,
  DocumentId,
  Relationship,
  RelationshipType,
} from '../model.js';
import { asBlockId, asSlug, isRelationshipType } from '../model.js';
import type { ContentSource } from './content-source.js';
import { deriveBlockId, deriveDocumentId, resolveSlugCollisions, slugify } from './ids.js';
import { DEFAULT_RELATIONSHIP_TYPES } from './vocabulary.js';

/**
 * Options for the compiler.
 */
export interface CompilerOptions {
  /**
   * The controlled vocabulary of relationship types. Defaults to
   * `DEFAULT_RELATIONSHIP_TYPES`. Relationships with types outside the
   * vocabulary are rejected and reported.
   */
  relationshipTypes?: readonly RelationshipType[];
}

/**
 * The compiler. Constructed with a `ContentSource` and optional
 * `CompilerOptions`. The `compile()` method produces a `CompiledModel`.
 */
export class Compiler {
  private readonly relationshipTypes: readonly RelationshipType[];

  constructor(
    private readonly source: ContentSource,
    options: CompilerOptions = {},
  ) {
    this.relationshipTypes = options.relationshipTypes ?? DEFAULT_RELATIONSHIP_TYPES;
  }

  async compile(): Promise<CompiledModel> {
    const paths = await this.source.list();
    const docs: Document[] = [];
    const blocks: ContentBlock[] = [];
    const rejectedUnknownTypes: CompilationReport['rejectedUnknownTypes'] = [];
    const rejectedUnresolvedTargets: CompilationReport['rejectedUnresolvedTargets'] = [];

    // First pass: compile each file into a document + its blocks, collecting
    // raw relationships (with string targets) for resolution.
    const rawDocs: Array<{
      doc: Document;
      blocks: ContentBlock[];
      rawRelationships: Array<{ source: BlockId; type: string; target: string }>;
    }> = [];

    for (const path of paths) {
      const text = await this.source.read(path);
      const compiled = this.compileFile(path, text);
      rawDocs.push(compiled);
    }

    // Build a set of all block IDs for target resolution.
    const knownBlockIds = new Set<string>();
    for (const rd of rawDocs) {
      for (const b of rd.blocks) knownBlockIds.add(b.id);
    }

    // Resolve relationships: admit those with recognised types and resolvable targets.
    for (const rd of rawDocs) {
      for (const b of rd.blocks) {
        const admitted: Relationship[] = [];
        for (const raw of rd.rawRelationships) {
          if (raw.source !== b.id) continue;
          if (!isRelationshipType(raw.type) || !this.relationshipTypes.includes(raw.type)) {
            rejectedUnknownTypes.push({
              source: raw.source,
              type: raw.type,
              target: raw.target,
            });
            continue;
          }
          if (!knownBlockIds.has(raw.target)) {
            rejectedUnresolvedTargets.push({
              source: raw.source,
              type: raw.type,
              target: raw.target,
            });
            continue;
          }
          admitted.push({ type: raw.type, target: asBlockId(raw.target) });
        }
        b.relationships = admitted;
      }
    }

    // Resolve slug collisions across all documents.
    const slugEntries = rawDocs.map((rd) => ({ documentId: rd.doc.id, slug: rd.doc.slug }));
    const resolvedSlugs = resolveSlugCollisions(slugEntries);
    for (const rd of rawDocs) {
      const slug = resolvedSlugs.get(rd.doc.id);
      if (slug) rd.doc.slug = slug;
      docs.push(rd.doc);
      blocks.push(...rd.blocks);
    }

    const report: CompilationReport = { rejectedUnknownTypes, rejectedUnresolvedTargets };
    return { documents: docs, blocks, report };
  }

  private compileFile(
    relativePath: string,
    text: string,
  ): {
    doc: Document;
    blocks: ContentBlock[];
    rawRelationships: Array<{ source: BlockId; type: string; target: string }>;
  } {
    const documentId = deriveDocumentId(relativePath);
    const tree = remark().use(remarkParse).use(remarkFrontmatter).parse(text);

    const frontmatter = extractFrontmatter(tree);
    const annotations = extractAnnotations(frontmatter);
    const metadata = extractMetadata(frontmatter);
    const frontmatterRelationships = extractFrontmatterRelationships(frontmatter);

    // Walk the tree, collecting headings and their content sections.
    const sections = collectSections(tree);
    if (sections.length === 0) {
      // No headings — no content blocks. The spec requires at least one heading.
      // We produce no document for this file.
      return {
        doc: {
          id: documentId,
          slug: asSlug(''),
          rootBlock: asBlockId(''),
          annotations: [],
          metadata,
        },
        blocks: [],
        rawRelationships: [],
      };
    }

    const rootSection = sections[0];
    if (!rootSection) throw new Error('unreachable');
    const slug = slugify(rootSection.headingText);
    const rootBlockId = deriveBlockId(documentId, rootSection.headingPath);

    const blocks: ContentBlock[] = [];
    const rawRelationships: Array<{ source: BlockId; type: string; target: string }> = [];

    for (const section of sections) {
      const blockId = deriveBlockId(documentId, section.headingPath);
      const parentPath = section.parentPath;
      const parent = parentPath ? deriveBlockId(documentId, parentPath) : null;
      const children = sections
        .filter((s) => s.parentPath === section.headingPath)
        .map((s) => deriveBlockId(documentId, s.headingPath));
      const content = stringifyContent(section.contentNodes);
      blocks.push({
        id: blockId,
        title: section.headingText,
        document: documentId,
        parent,
        content,
        children,
        relationships: [], // populated after resolution
      });
    }

    // Frontmatter relationships: the `from` references a heading path or slug
    // within this document. Resolve to a block ID.
    for (const rel of frontmatterRelationships) {
      const sourceBlockId = resolveRelationshipSource(rel.from, sections, documentId);
      if (sourceBlockId) {
        rawRelationships.push({ source: sourceBlockId, type: rel.type, target: rel.to });
      }
    }

    const doc: Document = {
      id: documentId,
      slug,
      rootBlock: rootBlockId,
      annotations,
      metadata,
    };

    return { doc, blocks, rawRelationships };
  }
}

// --- Section collection ---

interface Section {
  headingText: string;
  /** Position-based path, e.g. "1" for the first H1, "1.1" for its first H2 child. */
  headingPath: string;
  parentPath: string | null;
  contentNodes: Content[];
}

const collectSections = (tree: Root): Section[] => {
  const sections: Section[] = [];
  // Stack of (level, headingPath) for the current heading ancestry.
  const stack: Array<{ level: number; path: string }> = [];
  // Counter of children at each level under the current parent.
  const counters = new Map<string, number>();

  let current: Section | null = null;

  for (const node of tree.children) {
    if (node.type === 'heading') {
      // Close the previous section.
      if (current) sections.push(current);
      const heading = node as Heading;
      const level = heading.depth;
      // Pop stack until we find a parent with a smaller level.
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        stack.pop();
      }
      const parentPath = stack.length > 0 ? (stack[stack.length - 1]?.path ?? null) : null;
      const counterKey = parentPath ?? '';
      const count = (counters.get(counterKey) ?? 0) + 1;
      counters.set(counterKey, count);
      // Reset child counters when entering a new heading.
      counters.set(parentPath ? `${parentPath}.${count}` : String(count), 0);
      const headingPath = parentPath ? `${parentPath}.${count}` : String(count);
      stack.push({ level, path: headingPath });
      current = {
        headingText: headingText(heading),
        headingPath,
        parentPath,
        contentNodes: [],
      };
    } else if (current) {
      current.contentNodes.push(node);
    }
  }
  if (current) sections.push(current);
  return sections;
};

const headingText = (heading: Heading): string =>
  heading.children
    .map((c) => ('value' in c ? String(c.value) : ''))
    .join('')
    .trim();

const stringifyContent = (nodes: Content[]): string => {
  const processor = remark().use(remarkStringify);
  const result = processor.stringify({ type: 'root', children: nodes } as Root);
  return result.trim();
};

// --- Frontmatter extraction ---

type FrontmatterValue =
  string | number | boolean | FrontmatterValue[] | { [key: string]: FrontmatterValue } | null;

const extractFrontmatter = (tree: Root): Record<string, FrontmatterValue> | null => {
  const first = tree.children[0];
  if (first && first.type === 'yaml') {
    const yaml = (first as Yaml).value;
    return parseSimpleYaml(yaml);
  }
  return null;
};

const extractAnnotations = (frontmatter: Record<string, FrontmatterValue> | null): unknown[] => {
  if (!frontmatter) return [];
  const anns = frontmatter['annotations'];
  if (Array.isArray(anns)) return anns as unknown[];
  return [];
};

const extractMetadata = (
  frontmatter: Record<string, FrontmatterValue> | null,
): Record<string, unknown> | undefined => {
  if (!frontmatter) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key !== 'annotations' && key !== 'relationships') {
      result[key] = value as unknown;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const extractFrontmatterRelationships = (
  frontmatter: Record<string, FrontmatterValue> | null,
): Array<{ from: string; type: string; to: string }> => {
  if (!frontmatter) return [];
  const rels = frontmatter['relationships'];
  if (!Array.isArray(rels)) return [];
  const result: Array<{ from: string; type: string; to: string }> = [];
  for (const r of rels) {
    if (
      r &&
      typeof r === 'object' &&
      !Array.isArray(r) &&
      'from' in r &&
      'type' in r &&
      'to' in r
    ) {
      const obj = r as { from: FrontmatterValue; type: FrontmatterValue; to: FrontmatterValue };
      if (
        typeof obj.from === 'string' &&
        typeof obj.type === 'string' &&
        typeof obj.to === 'string'
      ) {
        result.push({ from: obj.from, type: obj.type, to: obj.to });
      }
    }
  }
  return result;
};

const resolveRelationshipSource = (
  from: string,
  sections: Section[],
  documentId: DocumentId,
): BlockId | null => {
  // `from` may be a heading path (e.g. "1.1") or a slugified heading text.
  const byPath = sections.find((s) => s.headingPath === from);
  if (byPath) return deriveBlockId(documentId, byPath.headingPath);
  const bySlug = sections.find((s) => slugify(s.headingText) === asSlug(from));
  if (bySlug) return deriveBlockId(documentId, bySlug.headingPath);
  return null;
};

// --- Minimal YAML parser for frontmatter ---
// remark-frontmatter extracts the YAML as a string but does not parse it.
// We implement a minimal YAML parser sufficient for the frontmatter shapes
// used by the source format: key-value pairs, lists of objects, and simple
// scalars. This avoids a dependency on a full YAML library. The parser is
// intentionally limited; complex YAML is out of scope for the initial compiler.

const parseSimpleYaml = (yaml: string): Record<string, FrontmatterValue> | null => {
  const lines = yaml.split('\n');
  const result: Record<string, FrontmatterValue> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const match = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)?$/.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? '';
    const rest = match[3] ?? '';
    if (rest.trim() === '') {
      // Could be a block (list or nested mapping). Peek ahead.
      const parsed = parseBlock(lines, i + 1, indent);
      result[key] = parsed.value;
      i = parsed.nextIndex;
    } else {
      result[key] = parseScalar(rest.trim());
      i++;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
};

const parseBlock = (
  lines: string[],
  start: number,
  parentIndent: number,
): { value: FrontmatterValue; nextIndex: number } => {
  // Determine the child indent by looking at the next non-blank line.
  let childIndent = -1;
  for (let j = start; j < lines.length; j++) {
    const line = lines[j];
    if (!line || line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = /^(\s*)\S/.exec(line);
    childIndent = m ? (m[1]?.length ?? 0) : 0;
    break;
  }
  if (childIndent <= parentIndent) {
    // Empty block.
    return { value: null, nextIndex: start };
  }
  // List?
  const firstNonBlank = lines[start]?.trim() ?? '';
  if (firstNonBlank.startsWith('- ')) {
    return parseList(lines, start, childIndent);
  }
  // Nested mapping.
  return parseMapping(lines, start, childIndent);
};

const parseList = (
  lines: string[],
  start: number,
  indent: number,
): { value: FrontmatterValue[]; nextIndex: number } => {
  const items: FrontmatterValue[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === '') {
      i++;
      continue;
    }
    const m = /^(\s*)-\s+(.*)$/.exec(line);
    if (!m || (m[1]?.length ?? 0) !== indent) break;
    const rest = m[2] ?? '';
    if (rest.includes(': ')) {
      // Inline mapping: `- key: value` (possibly multiple keys on following lines)
      const obj: Record<string, FrontmatterValue> = {};
      const first = parseInlineKeyValue(rest);
      if (first) {
        obj[first.key] = first.value;
      }
      i++;
      // Consume subsequent indented key: value lines belonging to this item.
      while (i < lines.length) {
        const next = lines[i];
        if (!next || next.trim() === '') {
          i++;
          continue;
        }
        const nm = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*):\s+(.*)$/.exec(next);
        if (nm && (nm[1]?.length ?? 0) > indent) {
          obj[nm[2] ?? ''] = parseScalar((nm[3] ?? '').trim());
          i++;
        } else {
          break;
        }
      }
      items.push(obj);
    } else {
      items.push(parseScalar(rest.trim()));
      i++;
    }
  }
  return { value: items, nextIndex: i };
};

const parseMapping = (
  lines: string[],
  start: number,
  indent: number,
): { value: Record<string, FrontmatterValue>; nextIndex: number } => {
  const result: Record<string, FrontmatterValue> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim() === '') {
      i++;
      continue;
    }
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)?$/.exec(line);
    if (!m || (m[1]?.length ?? 0) !== indent) break;
    const key = m[2] ?? '';
    const rest = m[3] ?? '';
    if (rest.trim() === '') {
      const parsed = parseBlock(lines, i + 1, indent);
      result[key] = parsed.value;
      i = parsed.nextIndex;
    } else {
      result[key] = parseScalar(rest.trim());
      i++;
    }
  }
  return { value: result, nextIndex: i };
};

const parseInlineKeyValue = (text: string): { key: string; value: FrontmatterValue } | null => {
  const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(text);
  if (!m) return null;
  return { key: m[1] ?? '', value: parseScalar((m[2] ?? '').trim()) };
};

const parseScalar = (value: string): FrontmatterValue => {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  // Quoted strings.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

// --- Convenience function ---

/**
 * Compile a `ContentSource` into a `CompiledModel`. Convenience wrapper around
 * the `Compiler` class.
 */
export const compile = async (
  source: ContentSource,
  options?: CompilerOptions,
): Promise<CompiledModel> => {
  const compiler = new Compiler(source, options);
  return compiler.compile();
};
