import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, posix, relative, resolve } from 'node:path';

import { isPathUnderWorkspace } from '../gateway/workspace-editor-path.js';
import type { HostedPublicationSnapshot } from './hosted-session-share.js';
import { resolveMimeType } from './share-store.js';

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

export interface HostedStaticSitePublicationSnapshot extends HostedPublicationSnapshot {
  kind: 'static_site';
  rootDir: string;
  title: string;
  fileCount: number;
  totalBytes: number;
}

export class HostedStaticSitePublicationBuilder {
  async build(workspaceRoot: string, input: {
    path: string;
    title?: string;
    description?: string;
    spaFallback?: boolean;
  }): Promise<HostedStaticSitePublicationSnapshot> {
    const relativePath = normalizeInputPath(input.path);
    const sourcePath = resolve(workspaceRoot, relativePath);
    const realSource = await realpath(sourcePath);
    if (!isPathUnderWorkspace(workspaceRoot, realSource)) throw new Error('Static site path is outside the workspace');
    const sourceStat = await stat(realSource);
    const singleHtml = sourceStat.isFile();
    if (singleHtml && resolveMimeType(realSource) !== 'text/html') {
      throw new Error('Static site file must be an HTML document');
    }
    if (!singleHtml && !sourceStat.isDirectory()) throw new Error('Static site source must be an HTML file or directory');

    const rootDir = singleHtml ? dirname(realSource) : realSource;
    const entries = singleHtml
      ? [{ path: 'index.html', absolutePath: realSource }]
      : (await collectFiles(rootDir)).map((path) => ({ path, absolutePath: resolve(rootDir, path) }));
    if (!singleHtml && !entries.some((entry) => entry.path === 'index.html')) {
      throw new Error('Static site must contain index.html');
    }
    const assets: HostedPublicationSnapshot['assets'] = [];
    const files: Array<{ id: string; path: string; mimeType: string; size: number; sha256: string }> = [];
    let totalBytes = 0;
    for (const entry of entries) {
      const filePath = entry.path;
      const absolutePath = entry.absolutePath;
      const fileStat = await stat(absolutePath);
      if (fileStat.size > MAX_FILE_BYTES) throw new Error(`Static site file exceeds publishing limit: ${filePath}`);
      totalBytes += fileStat.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Static site exceeds total publishing limit');
      const id = createHash('sha256').update(filePath).digest('hex').slice(0, 40);
      assets.push({ id, path: absolutePath, size: fileStat.size });
      files.push({ id, path: filePath, mimeType: resolveMimeType(filePath), size: fileStat.size, sha256: await sha256File(absolutePath) });
    }
    const defaultTitle = singleHtml
      ? basename(realSource, extname(realSource))
      : basename(realSource);
    const title = input.title?.trim() || defaultTitle || 'Published site';
    return {
      kind: 'static_site',
      rootDir,
      title,
      fileCount: files.length,
      totalBytes,
      assets,
      manifest: {
        schemaVersion: 1,
        kind: 'static_site',
        title,
        snapshotAt: new Date().toISOString(),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        entrypoint: 'index.html',
        spaFallback: input.spaFallback ?? true,
        files,
      },
    };
  }
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const details = await lstat(absolutePath);
      if (details.isSymbolicLink()) throw new Error(`Static site cannot contain symbolic links: ${entry.name}`);
      if (details.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!details.isFile()) throw new Error(`Unsupported static site entry: ${entry.name}`);
      const filePath = relative(rootDir, absolutePath).split('\\').join('/');
      if (filePath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid static site path');
      files.push(posix.normalize(filePath));
      if (files.length > MAX_FILES) throw new Error(`Static site has more than ${MAX_FILES} files`);
    }
  };
  await visit(rootDir);
  return files;
}

function normalizeInputPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some((part) => part === '..')) {
    throw new Error('Invalid static site path');
  }
  return normalized;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
