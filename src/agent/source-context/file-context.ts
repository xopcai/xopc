import { open } from 'node:fs/promises';

import type { FileSpaceService } from '../../files/file-service.js';
import type { AgentSourceContext } from './types.js';

const MAX_FILE_CONTEXT_BYTES = 96_000;
const MAX_DIRECTORY_ENTRIES = 200;

function isTextResource(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType.includes('json')
    || mimeType.includes('javascript')
    || mimeType.includes('typescript')
    || mimeType.includes('xml')
    || mimeType.includes('yaml');
}

export async function buildFileAgentContext(
  files: FileSpaceService,
  sourceId: string,
  expectedVersion?: string,
  expectedSpaceId?: string,
): Promise<AgentSourceContext | null> {
  const resolved = await files.resource(sourceId).catch(() => null);
  if (!resolved
    || (expectedSpaceId && expectedSpaceId !== resolved.space.id)
    || (expectedVersion && expectedVersion !== resolved.resource.revision)) return null;
  const { resource } = resolved;

  if (resource.kind === 'directory') {
    const children = await files.children(resource.spaceId, resource.relativePath).catch(() => null);
    if (!children) return null;
    const rows = children.slice(0, MAX_DIRECTORY_ENTRIES).map((child) => ({
      path: child.relativePath,
      kind: child.kind,
      size: child.size,
    }));
    return {
      kind: 'file',
      fileKind: 'directory',
      sourceId,
      version: resource.revision,
      title: resource.relativePath || resource.name,
      text: JSON.stringify({ directory: resource.relativePath, entries: rows }, null, 2),
      truncated: children.length > rows.length,
    };
  }

  if (!isTextResource(resource.mimeType)) {
    return {
      kind: 'file',
      fileKind: 'file',
      sourceId,
      version: resource.revision,
      title: resource.relativePath || resource.name,
      text: JSON.stringify({
        path: resource.relativePath,
        mimeType: resource.mimeType,
        size: resource.size,
      }, null, 2),
    };
  }

  const handle = await open(resolved.absolutePath, 'r');
  const bounded = Buffer.alloc(Math.min(resource.size, MAX_FILE_CONTEXT_BYTES));
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(bounded, 0, bounded.length, 0));
  } finally {
    await handle.close();
  }
  return {
    kind: 'file',
    fileKind: 'file',
    sourceId,
    version: resource.revision,
    title: resource.relativePath || resource.name,
    text: bounded.subarray(0, bytesRead).toString('utf8'),
    truncated: resource.size > bytesRead,
  };
}
