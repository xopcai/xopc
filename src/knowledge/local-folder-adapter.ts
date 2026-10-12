import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import type { KnowledgePullInput, KnowledgePullResult, KnowledgeSourceAdapter, KnowledgeSourceItemInput } from './types.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv']);
const IGNORED_DIRECTORIES = new Set(['.git', '.svn', 'node_modules']);
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class LocalFolderKnowledgeSourceAdapter implements KnowledgeSourceAdapter {
  readonly kind = 'local-folder';

  constructor(private readonly rootPath: string, private readonly pageSize = MAX_FILES) {}

  async pull(input: KnowledgePullInput): Promise<KnowledgePullResult> {
    const scanStartedAt = new Date().toISOString();
    const root = await realpath(resolve(this.rootPath));
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new Error(`Local knowledge source is not a directory: ${root}`);
    const paths: string[] = [];
    const warnings: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Local folder sync aborted.');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path);
          continue;
        }
        if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) paths.push(path);
      }
    };
    await walk(root);
    paths.sort((left, right) => left.localeCompare(right));
    let after: string | undefined;
    try { after = (JSON.parse(input.cursor ?? '{}') as { after?: string }).after; } catch { /* Legacy timestamp checkpoint. */ }
    const remaining = after ? paths.filter(path => relative(root, path).localeCompare(after) > 0) : paths;
    const page = remaining.slice(0, this.pageSize);
    const hasMore = remaining.length > page.length;

    const items: KnowledgeSourceItemInput[] = [];
    for (const path of page) {
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Local folder sync aborted.');
      const fileStat = await stat(path);
      const canonicalPath = await realpath(path);
      if (canonicalPath !== root && !canonicalPath.startsWith(`${root}${sep}`)) continue;
      if (fileStat.size > MAX_FILE_BYTES) {
        warnings.push(`File exceeds ${MAX_FILE_BYTES} bytes and was excluded: ${relative(root, canonicalPath)}`);
        continue;
      }
      const normalizedText = await readFile(canonicalPath, 'utf8');
      const externalId = relative(root, canonicalPath).split(sep).join('/');
      items.push({
        sourceInstanceId: input.instanceId,
        collectionScope: 'files',
        externalId,
        itemType: 'local_file',
        authorRole: 'unknown',
        sourceUpdatedAt: fileStat.mtime.toISOString(),
        contentHash: createHash('sha256').update(normalizedText).digest('hex'),
        normalizedText,
        metadata: { path: externalId, rootPath: root },
        sensitivity: inferMemorySensitivity(normalizedText),
        retentionClass: 'bounded',
        synthesisPipeline: 'connected_knowledge',
      });
    }

    return {
      items,
      nextCursor: hasMore ? JSON.stringify({ after: relative(root, page.at(-1)!).split(sep).join('/') }) : scanStartedAt,
      hasMore,
      warnings,
      snapshotExternalIds: warnings.length ? undefined : paths.map(path => relative(root, path).split(sep).join('/')),
    };
  }
}
