import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { FileResource, FileSpace } from '@xopcai/gateway-contract';
import type { Context, Hono } from 'hono';

import { FileServiceError, type FileSpaceService, fileResourceFromPath, resolveFilePath } from '../../../files/file-service.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';
import { fuzzySubsequenceScore, fuzzySearchWorkspaceFiles } from '../../workspace-file-search.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { registerFileReferenceRoutes } from './file-references.js';

const mutationLocks = new Map<string, Promise<void>>();

async function withMutationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = mutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  mutationLocks.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (mutationLocks.get(key) === tail) mutationLocks.delete(key);
  }
}

function publicSpace(space: Awaited<ReturnType<FileSpaceService['get']>>): FileSpace {
  const { root: _root, ...value } = space;
  return value;
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof FileServiceError) {
    return c.json({ error: { message: error.message } }, error.status);
  }
  throw error;
}

function contentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const sanitized = fileName.replace(/[\u0000-\u001f\u007f]/g, '_');
  const asciiFallback = sanitized.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(sanitized).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

async function collectFiles(files: FileSpaceService, spaceId: string, max: number): Promise<FileResource[]> {
  const output: FileResource[] = [];
  const directories = [''];
  const visited = new Set<string>();
  const space = await files.get(spaceId);
  while (directories.length && output.length < max) {
    const directory = directories.shift()!;
    const canonical = await resolveFilePath(space.root, directory).catch(() => null);
    if (!canonical || visited.has(canonical)) continue;
    visited.add(canonical);
    const children = await files.children(spaceId, directory);
    for (const child of children) {
      if (child.kind === 'directory') directories.push(child.relativePath);
      else output.push(child);
      if (output.length >= max) break;
    }
  }
  return output;
}

export function registerFilesRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const files = getGatewayFileSpaceService(deps.service);
  registerFileReferenceRoutes(authenticated, deps);

  authenticated.get('/api/files/spaces', async (c) => {
    try {
      return c.json({ spaces: (await files.list()).map(publicSpace) });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/default-space', async (c) => {
    try {
      return c.json({ space: publicSpace(await files.defaultSpace()) });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/contexts/:kind/:id', async (c) => {
    try {
      const kind = c.req.param('kind');
      if (kind !== 'agent' && kind !== 'project' && kind !== 'session') throw new FileServiceError(400, 'Invalid context kind');
      return c.json({ space: publicSpace(await files.forContext(kind, c.req.param('id'))) });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/spaces/:id/children', async (c) => {
    try {
      return c.json({ items: await files.children(c.req.param('id'), c.req.query('path') ?? '') });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/recent', async (c) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50));
      const spaces = await files.list();
      const items = (await Promise.all(spaces.map((space) => collectFiles(files, space.id, 5_000))))
        .flat()
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, limit);
      return c.json({ items });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/search', async (c) => {
    try {
      const query = (c.req.query('q') ?? '').trim().toLocaleLowerCase();
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50));
      const requestedSpaceId = c.req.query('spaceId');
      const spaces = requestedSpaceId ? [await files.get(requestedSpaceId)] : await files.list();
      const matches = await Promise.all(spaces.map(async (space) => {
        const candidates = await fuzzySearchWorkspaceFiles(space.root, query, limit);
        return Promise.all(candidates.map(async (candidate) => {
          try {
            const absolutePath = await resolveFilePath(space.root, candidate.path);
            return await fileResourceFromPath(space, absolutePath);
          } catch (error) {
            if (error instanceof FileServiceError) return null;
            throw error;
          }
        }));
      }));
      const items = matches.flat()
        .filter((file): file is FileResource => file !== null)
        .map((file) => ({ file, score: Math.max(
          fuzzySubsequenceScore(query, file.relativePath) ?? -Infinity,
          fuzzySubsequenceScore(query, file.name) ?? -Infinity,
        ) }))
        .sort((a, b) => b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath))
        .slice(0, limit)
        .map((row) => row.file);
      return c.json({ items });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.post('/api/files/resolve', async (c) => {
    try {
      const body = await c.req.json<{ spaceId?: string; path?: string }>();
      if (!body.spaceId || !body.path) throw new FileServiceError(400, 'spaceId and path are required');
      const space = await files.get(body.spaceId);
      const absolutePath = await resolveFilePath(space.root, body.path);
      return c.json({ resource: await fileResourceFromPath(space, absolutePath) });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/:id', async (c) => {
    try {
      return c.json({ resource: (await files.resource(c.req.param('id'))).resource });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/:id/host-path', async (c) => {
    try {
      return c.json({ absolutePath: (await files.resource(c.req.param('id'))).absolutePath });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.get('/api/files/:id/content', async (c) => {
    try {
      const { resource, absolutePath } = await files.resource(c.req.param('id'));
      if (resource.kind !== 'file') throw new FileServiceError(400, 'Resource is not a file');
      if (c.req.header('if-none-match') === resource.revision) return c.body(null, 304);
      c.header('Content-Type', resource.mimeType);
      c.header('ETag', resource.revision);
      c.header('Content-Disposition', contentDisposition('inline', resource.name));
      return c.body(await readFile(absolutePath));
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.put('/api/files/:id/content', async (c) => {
    try {
      const body = await c.req.json<{ content?: string; revision?: string }>();
      if (typeof body.content !== 'string' || !body.revision) throw new FileServiceError(400, 'content and revision are required');
      const id = c.req.param('id');
      const initial = await files.resource(id);
      const resource = await withMutationLock(initial.absolutePath, async () => {
        const current = await files.resource(id);
        if (current.absolutePath !== initial.absolutePath) throw new FileServiceError(409, 'File has changed');
        if (!current.resource.capabilities.includes('edit')) throw new FileServiceError(403, 'File is not editable');
        if (body.revision !== current.resource.revision) throw new FileServiceError(409, 'File has changed');
        await writeFile(current.absolutePath, body.content, 'utf8');
        return (await files.resource(id)).resource;
      });
      return c.json({ resource });
    } catch (error) { return errorResponse(c, error); }
  });

  authenticated.post('/api/files/spaces/:id/upload', async (c) => {
    try {
      const space = await files.get(c.req.param('id'));
      if (!space.writable) throw new FileServiceError(403, 'File space is read-only');
      const form = await c.req.formData();
      const upload = form.get('file');
      const directory = String(form.get('directory') ?? '');
      if (!(upload instanceof File)) throw new FileServiceError(400, 'file is required');
      const name = basename(upload.name).trim();
      if (!name || name !== upload.name) throw new FileServiceError(400, 'Invalid file name');
      const parent = await resolveFilePath(space.root, directory);
      const target = await resolveFilePath(space.root, join(directory, name), false);
      if (target === parent) throw new FileServiceError(400, 'Invalid file name');
      await writeFile(target, new Uint8Array(await upload.arrayBuffer()), { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') throw new FileServiceError(409, 'File already exists');
        throw error;
      });
      return c.json({ resource: await fileResourceFromPath(space, target) }, 201);
    } catch (error) { return errorResponse(c, error); }
  });
}
