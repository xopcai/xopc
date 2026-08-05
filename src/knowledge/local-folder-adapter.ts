import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

import type { KnowledgePullInput, KnowledgePullResult, KnowledgeSourceAdapter, KnowledgeSourceItemInput } from './types.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv']);
const IGNORED_DIRECTORIES = new Set(['.git', '.svn', 'node_modules']);
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export class LocalFolderKnowledgeSourceAdapter implements KnowledgeSourceAdapter {
  readonly kind = 'local-folder';

  constructor(private readonly rootPath: string) {}

  async pull(input: KnowledgePullInput): Promise<KnowledgePullResult> {
    const scanStartedAt = new Date().toISOString();
    const root = await realpath(resolve(this.rootPath));
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new Error(`Local knowledge source is not a directory: ${root}`);
    const cursorMs = input.cursor ? Date.parse(input.cursor) : Number.NaN;
    const windowMs = input.windowStart ? Date.parse(input.windowStart) : Number.NaN;
    const changedAfter = Math.max(
      Number.isFinite(cursorMs) ? cursorMs : 0,
      Number.isFinite(windowMs) ? windowMs : 0,
    );
    const paths: string[] = [];
    const warnings: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Local folder sync aborted.');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (paths.length >= MAX_FILES) return;
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
    if (paths.length >= MAX_FILES) warnings.push(`Local folder sync was limited to ${MAX_FILES} files.`);

    const items: KnowledgeSourceItemInput[] = [];
    for (const path of paths) {
      if (input.signal.aborted) throw input.signal.reason ?? new Error('Local folder sync aborted.');
      const fileStat = await stat(path);
      if (fileStat.size > MAX_FILE_BYTES || fileStat.mtimeMs <= changedAfter) continue;
      const canonicalPath = await realpath(path);
      if (canonicalPath !== root && !canonicalPath.startsWith(`${root}${sep}`)) continue;
      const normalizedText = await readFile(canonicalPath, 'utf8');
      const externalId = relative(root, canonicalPath).split(sep).join('/');
      items.push({
        sourceInstanceId: input.instanceId,
        collectionScope: 'files',
        externalId,
        itemType: 'local_file',
        authorRole: 'user',
        sourceUpdatedAt: fileStat.mtime.toISOString(),
        contentHash: createHash('sha256').update(normalizedText).digest('hex'),
        normalizedText,
        metadata: { path: externalId, rootPath: root },
        sensitivity: 'personal',
        retentionClass: 'durable',
        synthesisPipeline: 'connected_knowledge',
      });
    }

    return {
      items,
      nextCursor: scanStartedAt,
      warnings,
      snapshotExternalIds: paths.length < MAX_FILES
        ? paths.map((path) => relative(root, path).split(sep).join('/'))
        : undefined,
    };
  }
}
