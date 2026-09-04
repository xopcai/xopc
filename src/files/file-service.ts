import { createHash } from 'node:crypto';
import { access, lstat, opendir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { FileCapability, FileResource, FileSpace, FileSpaceBinding } from '@xopcai/gateway-contract';

import { listAgentEntries, resolveAgentWorkspaceDir, resolveDefaultAgentId } from '../agent/agent-scope.js';
import type { Config } from '../config/schema.js';
import { resolveProjectAgentId, type ProjectService } from '../projects/index.js';

const SKIPPED_NAMES = new Set(['.DS_Store', '.git', 'node_modules']);
const TEXT_EXTENSIONS = new Set([
  'css', 'csv', 'html', 'htm', 'js', 'json', 'jsx', 'md', 'markdown', 'mjs', 'cjs', 'svg', 'ts', 'tsx', 'tsv', 'txt', 'xml', 'yaml', 'yml',
]);
const MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript',
  csv: 'text/csv', tsv: 'text/tab-separated-values', xml: 'application/xml', yaml: 'application/yaml', yml: 'application/yaml',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

export type ResolvedFileSpace = FileSpace & { root: string };

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function normalizeRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalized.includes('\0') || normalized.split('/').some((part) => part === '..')) {
    throw new FileServiceError(400, 'Invalid file path');
  }
  return normalized.split('/').filter((part) => part && part !== '.').join('/');
}

function mimeType(name: string, directory: boolean): string {
  if (directory) return 'inode/directory';
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

function capabilities(name: string, directory: boolean, writable: boolean): FileCapability[] {
  if (directory) return writable ? ['share', 'upload'] : ['share'];
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const result: FileCapability[] = ['download', 'share'];
  if (MIME_TYPES[extension] || TEXT_EXTENSIONS.has(extension)) result.unshift('preview');
  if (writable && TEXT_EXTENSIONS.has(extension)) result.push('edit');
  return result;
}

export function fileSpaceId(root: string): string {
  return createHash('sha256').update(root).digest('base64url').slice(0, 24);
}

export function fileResourceId(spaceId: string, relativePath: string): string {
  return `${spaceId}.${Buffer.from(normalizeRelativePath(relativePath)).toString('base64url')}`;
}

export function parseFileResourceId(id: string): { spaceId: string; relativePath: string } {
  const separator = id.indexOf('.');
  if (separator <= 0) throw new FileServiceError(400, 'Invalid file id');
  try {
    return {
      spaceId: id.slice(0, separator),
      relativePath: normalizeRelativePath(Buffer.from(id.slice(separator + 1), 'base64url').toString('utf8')),
    };
  } catch (error) {
    if (error instanceof FileServiceError) throw error;
    throw new FileServiceError(400, 'Invalid file id');
  }
}

export async function resolveFilePath(root: string, path: string, mustExist = true): Promise<string> {
  const canonicalRoot = await realpath(root).catch(() => { throw new FileServiceError(404, 'File space is unavailable'); });
  const candidate = isAbsolute(path)
    ? resolve(path)
    : resolve(canonicalRoot, normalizeRelativePath(path));
  if (!mustExist) {
    const parent = await realpath(dirname(candidate)).catch(() => { throw new FileServiceError(404, 'Parent directory not found'); });
    if (!isWithin(canonicalRoot, parent)) throw new FileServiceError(400, 'Invalid file path');
    return resolve(parent, basename(candidate));
  }
  const canonicalTarget = await realpath(candidate).catch(() => { throw new FileServiceError(404, 'File not found'); });
  if (!isWithin(canonicalRoot, canonicalTarget)) throw new FileServiceError(400, 'File is outside its space');
  return canonicalTarget;
}

export class FileServiceError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

export async function fileResourceFromPath(
  space: ResolvedFileSpace,
  absolutePath: string,
  displayPath = absolutePath,
): Promise<FileResource> {
  const info = await stat(absolutePath);
  const revisionInfo = await stat(absolutePath, { bigint: true });
  const canonicalRoot = await realpath(space.root);
  const relativePath = relative(canonicalRoot, displayPath).split(sep).join('/');
  const name = basename(displayPath);
  const directory = info.isDirectory();
  return {
    id: fileResourceId(space.id, relativePath),
    spaceId: space.id,
    name,
    relativePath,
    parentPath: dirname(relativePath).split(sep).join('/').replace(/^\.$/, ''),
    kind: directory ? 'directory' : 'file',
    mimeType: mimeType(name, directory),
    size: info.size,
    modifiedAt: Math.max(0, Math.round(info.mtimeMs)),
    revision: `${revisionInfo.mtimeNs}:${revisionInfo.ctimeNs}:${revisionInfo.ino}:${revisionInfo.size}`,
    capabilities: capabilities(name, directory, space.writable),
  };
}

export class FileSpaceService {
  private readonly dynamicSpaces = new Map<string, ResolvedFileSpace>();
  private cache: { at: number; spaces: ResolvedFileSpace[] } | null = null;

  constructor(
    private readonly getConfig: () => Config,
    private readonly projects: ProjectService,
    private readonly resolveSessionWorkspace: (sessionKey: string) => string | Promise<string>,
    private readonly listSessionWorkspaces: () => Array<{ sessionKey: string; root: string }> | Promise<Array<{ sessionKey: string; root: string }>> = () => [],
  ) {}

  private async createSpace(
    root: string,
    title: string,
    bindings: FileSpaceBinding[],
  ): Promise<ResolvedFileSpace | null> {
    const canonicalRoot = await realpath(root).catch(() => null);
    if (!canonicalRoot) return null;
    const rootStat = await stat(canonicalRoot).catch(() => null);
    if (!rootStat?.isDirectory()) return null;
    const writable = await access(canonicalRoot, constants.W_OK).then(() => true).catch(() => false);
    return {
      id: fileSpaceId(canonicalRoot), title, kind: 'workspace', bindings, writable, root: canonicalRoot,
      lastActivityAt: Math.max(0, Math.round(rootStat.mtimeMs)),
    };
  }

  async list(): Promise<ResolvedFileSpace[]> {
    if (this.cache && Date.now() - this.cache.at < 5_000) return this.cache.spaces;
    const config = this.getConfig();
    const spaces: ResolvedFileSpace[] = [];
    for (const agent of listAgentEntries(config)) {
      const space = await this.createSpace(resolveAgentWorkspaceDir(config, agent.id), agent.id, [{ kind: 'agent', id: agent.id }]);
      if (space) spaces.push(space);
    }
    let offset = 0;
    while (true) {
      const page = this.projects.list({ limit: 500, offset });
      for (const project of page.items) {
        const agentId = resolveProjectAgentId({ config, projects: this.projects, projectId: project.id });
        const root = project.workspaceRoot ?? resolveAgentWorkspaceDir(config, agentId);
        const space = await this.createSpace(root, project.name, [{ kind: 'project', id: project.id }]);
        if (space) spaces.push(space);
      }
      if (!page.hasMore || page.items.length === 0) break;
      offset += page.items.length;
    }
    const merged = new Map<string, ResolvedFileSpace>();
    for (const { sessionKey, root } of await this.listSessionWorkspaces()) {
      const space = await this.createSpace(root, sessionKey, [{ kind: 'session', id: sessionKey }]);
      if (space) spaces.push(space);
    }
    for (const space of [...spaces, ...this.dynamicSpaces.values()]) {
      const existing = merged.get(space.id);
      if (existing) existing.bindings = [...existing.bindings, ...space.bindings.filter((binding) => !existing.bindings.some((item) => item.kind === binding.kind && item.id === binding.id))];
      else merged.set(space.id, { ...space, bindings: [...space.bindings] });
    }
    const result = [...merged.values()].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
    this.cache = { at: Date.now(), spaces: result };
    return result;
  }

  async forContext(kind: 'agent' | 'project' | 'session', id: string): Promise<ResolvedFileSpace> {
    let root: string | undefined;
    let title = id;
    if (kind === 'agent') root = resolveAgentWorkspaceDir(this.getConfig(), id);
    if (kind === 'project') {
      const project = this.projects.get(id);
      if (project) {
        const config = this.getConfig();
        const agentId = resolveProjectAgentId({ config, projects: this.projects, projectId: id });
        root = project.workspaceRoot ?? resolveAgentWorkspaceDir(config, agentId);
      }
      title = project?.name ?? id;
    }
    if (kind === 'session') root = await this.resolveSessionWorkspace(id);
    if (!root) throw new FileServiceError(404, 'File space not found');
    const space = await this.createSpace(root, title, [{ kind, id }]);
    if (!space) throw new FileServiceError(404, 'File space is unavailable');
    this.dynamicSpaces.set(space.id, space);
    this.cache = null;
    return space;
  }

  defaultSpace(): Promise<ResolvedFileSpace> {
    return this.forContext('agent', resolveDefaultAgentId(this.getConfig()));
  }

  async get(id: string): Promise<ResolvedFileSpace> {
    const hadCache = this.cache !== null;
    let space = (await this.list()).find((item) => item.id === id);
    if (!space && hadCache) {
      this.cache = null;
      space = (await this.list()).find((item) => item.id === id);
    }
    if (!space) throw new FileServiceError(404, 'File space not found');
    return space;
  }

  async resource(id: string): Promise<{ space: ResolvedFileSpace; resource: FileResource; absolutePath: string }> {
    const locator = parseFileResourceId(id);
    const space = await this.get(locator.spaceId);
    const absolutePath = await resolveFilePath(space.root, locator.relativePath);
    return { space, resource: await fileResourceFromPath(space, absolutePath, resolve(space.root, locator.relativePath)), absolutePath };
  }

  async rootResource(spaceId: string): Promise<FileResource> {
    const space = await this.get(spaceId);
    const absolutePath = await resolveFilePath(space.root, '');
    return fileResourceFromPath(space, absolutePath);
  }

  async children(spaceId: string, path = ''): Promise<FileResource[]> {
    const space = await this.get(spaceId);
    const directory = await resolveFilePath(space.root, path);
    if (!(await stat(directory)).isDirectory()) throw new FileServiceError(400, 'Path is not a directory');
    const entries: FileResource[] = [];
    const dir = await opendir(directory);
    for await (const entry of dir) {
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const target = resolve(directory, entry.name);
      const linkInfo = await lstat(target).catch(() => null);
      if (!linkInfo) continue;
      const canonicalTarget = await resolveFilePath(space.root, target).catch(() => null);
      if (!canonicalTarget) continue;
      const info = await stat(canonicalTarget).catch(() => null);
      if (!info || (!info.isFile() && !info.isDirectory())) continue;
      entries.push(await fileResourceFromPath(space, canonicalTarget, resolve(space.root, path, entry.name)));
    }
    return entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
  }
}
