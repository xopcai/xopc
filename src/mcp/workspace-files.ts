import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import { FileServiceError, fileResourceId, type FileSpaceService, type ResolvedFileSpace } from '../files/file-service.js';
import { fuzzySearchWorkspaceFiles } from '../gateway/workspace-file-search.js';

const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const fileBindingSchema = z.object({
  kind: z.enum(['agent', 'project', 'session']),
  id: z.string(),
});

const fileSpaceSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['workspace', 'artifact_store']),
  bindings: z.array(fileBindingSchema),
  writable: z.boolean(),
  lastActivityAt: z.number().optional(),
});

const fileResourceSummarySchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(['file', 'directory']),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  modifiedAt: z.number().optional(),
  revision: z.string().optional(),
});

export const McpFileSpacesOutput = z.object({
  spaces: z.array(fileSpaceSummarySchema),
});

export const McpFileListOutput = z.object({
  spaceId: z.string(),
  path: z.string(),
  items: z.array(fileResourceSummarySchema),
});

export const McpFileSearchOutput = z.object({
  query: z.string(),
  hits: z.array(z.object({
    id: z.string(),
    spaceId: z.string(),
    spaceTitle: z.string(),
    name: z.string(),
    relativePath: z.string(),
    kind: z.enum(['file', 'directory']),
  })),
});

export const McpFileReadOutput = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string(),
  relativePath: z.string(),
  mimeType: z.string().optional(),
  encoding: z.enum(['utf8', 'base64']),
  data: z.string(),
  size: cursor,
  offset: cursor,
  nextOffset: cursor.nullable(),
  revision: z.string(),
});

export const mcpFileTools = {
  'xopc.files.spaces': { scope: 'workspace.read' as const, output: McpFileSpacesOutput },
  'xopc.files.list': { scope: 'workspace.read' as const, output: McpFileListOutput },
  'xopc.files.search': { scope: 'workspace.read' as const, output: McpFileSearchOutput },
  'xopc.files.get': { scope: 'workspace.read' as const, output: McpFileReadOutput },
} as const;

const READ_CHUNK_BYTES = 48 * 1024;

function isWorkspaceSpace(space: ResolvedFileSpace): boolean {
  return !space.id.startsWith('host-');
}

function mapFileError(error: unknown): never {
  if (error instanceof CapabilityError) throw error;
  if (error instanceof FileServiceError) {
    const code = error.status === 404 ? 'NOT_FOUND'
      : error.status === 403 ? 'FORBIDDEN'
      : error.status === 409 ? 'REVISION_CONFLICT'
      : 'INVALID_INPUT';
    throw new CapabilityError(code, error.message);
  }
  throw error;
}

function summarizeResource(resource: {
  id: string; spaceId: string; name: string; relativePath: string; kind: 'file' | 'directory';
  size?: number; mimeType?: string; modifiedAt?: number; revision?: string;
}) {
  return {
    id: resource.id,
    spaceId: resource.spaceId,
    name: resource.name,
    relativePath: resource.relativePath,
    kind: resource.kind,
    ...(resource.size !== undefined ? { size: resource.size } : {}),
    ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
    ...(resource.modifiedAt !== undefined ? { modifiedAt: resource.modifiedAt } : {}),
    ...(resource.revision !== undefined ? { revision: resource.revision } : {}),
  };
}

function isTextMime(mimeType: string | undefined, name: string): boolean {
  if (mimeType) {
    if (mimeType.startsWith('text/')) return true;
    if (['application/json', 'application/xml', 'application/yaml', 'application/javascript', 'image/svg+xml'].includes(mimeType)) {
      return true;
    }
  }
  return /\.(?:md|markdown|txt|json|jsonc|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|css|scss|html|xml|sql|sh|bash|zsh|csv|tsv|env|ini|conf|log)$/i.test(name);
}

export function registerWorkspaceFiles(dispatcher: CapabilityDispatcher, getFiles: () => FileSpaceService): void {
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['mcp'] as const, scopes: ['workspace.read'] as const };

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.files.spaces',
    description: 'List accessible xopc workspace file spaces (agent, project, and session workspaces) with their bindings.',
    input: z.strictObject({
      projectId: z.string().trim().min(1).max(200).optional(),
    }),
    output: McpFileSpacesOutput,
    async execute({ projectId }, context) {
      context.assertCurrent?.();
      try {
        const spaces = (await getFiles().list()).filter(isWorkspaceSpace).filter(space =>
          !projectId || space.bindings.some(binding => binding.kind === 'project' && binding.id === projectId),
        );
        return {
          spaces: spaces.map(({ id, title, kind, bindings, writable, lastActivityAt }) => ({
            id, title, kind, bindings, writable, ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
          })),
        };
      } catch (error) {
        mapFileError(error);
      }
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.files.list',
    description: 'List files and subdirectories inside a workspace file space at a relative path. Pass returned file IDs to xopc_files_get or xopc_agent_runs_start references.',
    input: z.strictObject({
      spaceId: z.string().trim().min(1).max(256),
      path: z.string().max(2048).default(''),
      limit: z.number().int().min(1).max(200).default(100),
    }),
    output: McpFileListOutput,
    async execute({ spaceId, path, limit }, context) {
      context.assertCurrent?.();
      if (spaceId.startsWith('host-')) {
        throw new CapabilityError('FORBIDDEN', 'Host file spaces are not accessible via MCP');
      }
      try {
        const items = await getFiles().children(spaceId, path);
        return {
          spaceId,
          path,
          items: items.slice(0, limit).map(summarizeResource),
        };
      } catch (error) {
        mapFileError(error);
      }
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.files.search',
    description: 'Search workspace files and directories by name or relative path across accessible file spaces, optionally filtered by spaceId or projectId.',
    input: z.strictObject({
      query: z.string().trim().min(1).max(512),
      spaceId: z.string().trim().min(1).max(256).optional(),
      projectId: z.string().trim().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    output: McpFileSearchOutput,
    async execute({ query, spaceId, projectId, limit }, context) {
      context.assertCurrent?.();
      if (spaceId?.startsWith('host-')) {
        throw new CapabilityError('FORBIDDEN', 'Host file spaces are not accessible via MCP');
      }
      try {
        const files = getFiles();
        const spaces = spaceId
          ? [await files.get(spaceId)].filter(isWorkspaceSpace)
          : (await files.list()).filter(isWorkspaceSpace).filter(space =>
              !projectId || space.bindings.some(binding => binding.kind === 'project' && binding.id === projectId),
            );
        const perSpace = Math.max(5, Math.min(limit, 25));
        const nested = await Promise.all(spaces.slice(0, 12).map(async space => {
          const matches = await fuzzySearchWorkspaceFiles(space.root, query, perSpace).catch(() => []);
          return matches.map(match => ({
            id: fileResourceId(space.id, match.path),
            spaceId: space.id,
            spaceTitle: space.title,
            name: match.name,
            relativePath: match.path,
            kind: (match.isDirectory ? 'directory' : 'file') as 'file' | 'directory',
          }));
        }));
        return { query, hits: nested.flat().slice(0, limit) };
      } catch (error) {
        mapFileError(error);
      }
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.files.get',
    description: 'Read a workspace file by its file resource ID (returned by xopc_files_list, xopc_files_search, or xopc_agent_runs_result). Supports paginated UTF-8 or base64 reading via offset and nextOffset.',
    input: z.strictObject({
      id: z.string().trim().min(1).max(1024),
      offset: cursor.default(0),
      maxBytes: z.number().int().min(1).max(READ_CHUNK_BYTES).default(READ_CHUNK_BYTES),
      encoding: z.enum(['auto', 'utf8', 'base64']).default('auto'),
      expectedRevision: z.string().max(256).optional(),
    }),
    output: McpFileReadOutput,
    async execute({ id, offset, maxBytes, encoding, expectedRevision }, context) {
      context.assertCurrent?.();
      if (id.startsWith('host-')) {
        throw new CapabilityError('FORBIDDEN', 'Host file spaces are not accessible via MCP');
      }
      try {
        const resolved = await getFiles().resource(id);
        if (resolved.resource.kind !== 'file') {
          throw new CapabilityError('INVALID_INPUT', 'Target resource is a directory; use xopc_files_list instead');
        }
        const handle = await open(resolved.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
        if (!handle) throw new CapabilityError('NOT_FOUND', 'Workspace file is no longer available');
        try {
          const info = await handle.stat({ bigint: true });
          if (!info.isFile()) throw new CapabilityError('NOT_FOUND', 'Workspace file not found');
          const size = Number(info.size);
          const revision = createHash('sha256').update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`).digest('hex');
          if (expectedRevision !== undefined && expectedRevision !== revision) {
            throw new CapabilityError('REVISION_CONFLICT', 'Workspace file changed; re-read without expectedRevision to get the latest content');
          }
          const toRead = Math.min(maxBytes, Math.max(0, size - offset));
          const buf = Buffer.alloc(toRead);
          const { bytesRead } = toRead > 0 ? await handle.read(buf, 0, toRead, offset) : { bytesRead: 0 };
          const after = await handle.stat({ bigint: true });
          if (after.mtimeNs !== info.mtimeNs || after.ctimeNs !== info.ctimeNs || after.size !== info.size) {
            throw new CapabilityError('REVISION_CONFLICT', 'Workspace file changed during read');
          }
          context.assertCurrent?.();
          const slice = buf.subarray(0, bytesRead);
          const resolvedEncoding: 'utf8' | 'base64' = encoding === 'base64'
            ? 'base64'
            : encoding === 'utf8'
              ? 'utf8'
              : isTextMime(resolved.resource.mimeType, resolved.resource.name) ? 'utf8' : 'base64';
          return {
            id: resolved.resource.id,
            spaceId: resolved.space.id,
            name: resolved.resource.name,
            relativePath: resolved.resource.relativePath,
            ...(resolved.resource.mimeType ? { mimeType: resolved.resource.mimeType } : {}),
            encoding: resolvedEncoding,
            data: resolvedEncoding === 'utf8' ? slice.toString('utf8') : slice.toString('base64'),
            size,
            offset,
            nextOffset: bytesRead > 0 && offset + bytesRead < size ? offset + bytesRead : null,
            revision,
          };
        } finally {
          await handle.close();
        }
      } catch (error) {
        mapFileError(error);
      }
    },
  }));
}
