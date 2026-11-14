import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FileVersionSchema, type FileVersion } from '@xopcai/gateway-contract';

import { resolveStateDir } from '../config/paths-state.js';
import { FileServiceError, type FileSpaceService } from './file-service.js';

export const MAX_VERSION_BYTES = 8 * 1024 * 1024;

function versionRoot(absolutePath: string): string {
  return join(resolveStateDir(), 'file-versions', createHash('sha256').update(absolutePath).digest('hex'));
}

async function readVersion(directory: string): Promise<FileVersion | undefined> {
  try {
    return FileVersionSchema.parse(JSON.parse(await readFile(join(directory, 'version.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function listFileVersions(absolutePath: string): Promise<FileVersion[]> {
  const root = versionRoot(absolutePath);
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const versions: FileVersion[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const version = await readVersion(join(root, entry.name));
    if (version) versions.push(version);
  }
  return versions.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

export async function loadFileVersion(absolutePath: string, id: string) {
  const directory = join(versionRoot(absolutePath), id);
  const version = await readVersion(directory);
  if (!version) throw new FileServiceError(404, 'File version not found');
  return { version, content: await readFile(join(directory, 'content')) };
}

export async function saveFileVersion(
  files: FileSpaceService, fileId: string, absolutePath: string, revision: string, id: string,
): Promise<FileVersion> {
  const current = await files.resource(fileId);
  if (current.absolutePath !== absolutePath) throw new FileServiceError(409, 'File has changed');
  if (current.resource.kind !== 'file' || !current.resource.capabilities.includes('save_version')) {
    throw new FileServiceError(400, 'File cannot be versioned');
  }
  const root = versionRoot(absolutePath);
  const destination = join(root, id);
  const previous = await readVersion(destination);
  if (previous) {
    if (previous.revision !== revision) throw new FileServiceError(409, 'Version request has changed');
    return previous;
  }
  if (current.resource.revision !== revision) throw new FileServiceError(409, 'File has changed');
  if (current.resource.size > MAX_VERSION_BYTES) throw new FileServiceError(400, 'File too large to save a version');

  await mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, '.pending-'));
  try {
    await copyFile(absolutePath, join(staging, 'content'));
    const rechecked = await files.resource(fileId);
    if (rechecked.absolutePath !== absolutePath || rechecked.resource.revision !== revision) {
      throw new FileServiceError(409, 'File has changed');
    }
    const { name, size } = current.resource;
    const version = { id, revision, name, size, createdAt: Date.now() };
    await writeFile(join(staging, 'version.json'), JSON.stringify(version), { mode: 0o600 });
    await rename(staging, destination);
    return version;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
