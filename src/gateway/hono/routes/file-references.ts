import { realpath, stat } from 'node:fs/promises';

import type { Hono } from 'hono';

import { FileServiceError } from '../../../files/file-service.js';
import {
  buildFilePathClassifierContext,
  classifyFileLocation,
  displayNameForPath,
  fileRefSessionKeysMatch,
  resolveFileReferenceCandidate,
} from '../../file-path-classifier.js';
import { classifyFileReferenceFsError } from '../../file-reference-errors.js';
import { FileReferenceRegistry, type FileReferenceCapability } from '../../file-reference-registry.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

/** Metadata and explicit desktop actions for links outside a managed workspace. */
export function registerFileReferenceRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const files = getGatewayFileSpaceService(deps.service);
  const refs = new FileReferenceRegistry();

  app.post('/api/files/resolve-reference', async (c) => {
    const body = await c.req.json<{ spaceId?: string; path?: string; sessionKey?: string }>();
    if (!body.spaceId || !body.path?.trim()) return c.json({ error: { message: 'spaceId and path are required' } }, 400);
    try {
      const space = await files.get(body.spaceId);
      const sessionKey = body.sessionKey?.trim();
      const agentId = space.bindings.find((binding) => binding.kind === 'agent')?.id;
      const ctx = {
        ...buildFilePathClassifierContext(deps.service.currentConfig, sessionKey || (agentId ? `agent:${agentId}:main` : undefined)),
        workspaceRoot: space.root,
      };
      const inputPath = body.path.trim();
      const base = { inputPath, displayName: displayNameForPath(inputPath) };
      const { candidate, invalid } = await resolveFileReferenceCandidate(inputPath, space.root, ctx);
      if (!candidate || invalid) return c.json({ reference: { ...base, scope: 'invalid', exists: false, capabilities: [] } });
      let absolutePath: string;
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        absolutePath = await realpath(candidate);
        info = await stat(absolutePath);
      } catch (error) {
        const failure = classifyFileReferenceFsError(error);
        if (failure.code !== 'FILE_NOT_FOUND') return c.json({ error: { message: failure.message } }, failure.status === 403 ? 403 : 500);
        return c.json({ reference: { ...base, scope: 'missing', absolutePath: candidate, exists: false, capabilities: ['copyPath'] } });
      }
      const classified = classifyFileLocation(absolutePath, ctx);
      const capabilities: FileReferenceCapability[] = info.isFile() || info.isDirectory()
        ? ['openExternal', 'revealInFolder', 'copyPath'] : ['copyPath'];
      const ref = refs.register({ absolutePath, sessionKey, ...classified, capabilities });
      return c.json({ reference: {
        ...base, ...classified, fileRefId: ref.id, absolutePath,
        exists: true, isDirectory: info.isDirectory(), capabilities, mtimeMs: info.mtimeMs,
      } });
    } catch (error) {
      if (error instanceof FileServiceError) return c.json({ error: { message: error.message } }, error.status);
      throw error;
    }
  });

  app.post('/api/files/references/:id/action', async (c) => {
    const ref = refs.resolve(c.req.param('id'));
    if (!ref) return c.json({ error: { message: 'File reference expired' } }, 404);
    const body = await c.req.json<{ action?: string; sessionKey?: string }>();
    if (!fileRefSessionKeysMatch(ref.sessionKey, body.sessionKey)) return c.json({ error: { message: 'File reference forbidden' } }, 403);
    if ((body.action !== 'openExternal' && body.action !== 'revealInFolder') || !ref.capabilities.includes(body.action)) {
      return c.json({ error: { message: 'Action not allowed' } }, 403);
    }
    try {
      if (await realpath(ref.absolutePath) !== ref.absolutePath) return c.json({ error: { message: 'File reference changed' } }, 409);
      const info = await stat(ref.absolutePath);
      if (!info.isFile() && !info.isDirectory()) return c.json({ error: { message: 'Not a file or directory' } }, 400);
      return c.json({ absolutePath: ref.absolutePath, isDirectory: info.isDirectory() });
    } catch {
      return c.json({ error: { message: 'File not found' } }, 404);
    }
  });
}
