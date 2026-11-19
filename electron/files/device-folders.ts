import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, opendir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, parse, relative, sep } from 'node:path';
import { DEVICE_FOLDER_READ, deviceFolderDescriptors, deviceFolderGrantSchema, DEVICE_FOLDER_SEARCH,
  ENDPOINT_MAX_FILE_BYTES, type DeviceFolderGrant, type DeviceFolderSnapshot } from '@xopcai/endpoint-tools-protocol';
import type { EndpointToolDefinition } from '@xopcai/endpoint-tools-client';
import { z } from 'zod';

import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';

const localGrantSchema = deviceFolderGrantSchema.extend({ path: z.string().min(1).max(4096), identity: z.string().min(1) });
const localStateSchema = z.strictObject({ revision: z.number().int().nonnegative(), folders: z.array(localGrantSchema).max(20) });
type LocalGrant = z.infer<typeof localGrantSchema>;
type LocalState = z.infer<typeof localStateSchema>;
type FileRef = { folderId: string; path: string; identity: string; modifiedAt: number; size: number; expiresAt: number };

function fileIdentity(info: { dev: number; ino: number; birthtimeMs: number }): string {
  return `${info.dev}:${info.ino}:${info.birthtimeMs}`;
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return !!child && !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep);
}

export class DesktopFolderStore {
  private updates = Promise.resolve();
  private readonly refs = new Map<string, FileRef>();

  constructor(private readonly settingsPath: () => string, private readonly mimeType: (extension: string) => string) {}

  private async load(): Promise<LocalState> {
    try { return localStateSchema.parse(JSON.parse(await readFile(this.settingsPath(), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { revision: 0, folders: [] };
    }
  }

  async snapshot(): Promise<DeviceFolderSnapshot> {
    const state = await this.load();
    return { revision: state.revision, folders: state.folders.map(({ id, kind, label, mobileIds }) => ({ id, kind, label, mobileIds })) };
  }

  change(input: { id?: string; kind?: DeviceFolderGrant['kind']; path?: string; mobileIds: string[]; revoke?: boolean },
    publish: (snapshot: DeviceFolderSnapshot) => Promise<void>): Promise<DeviceFolderSnapshot> {
    const task = this.updates.then(async () => {
      const state = await this.load();
      const previous = input.id ? state.folders.find(folder => folder.id === input.id) : state.folders.find(folder => folder.kind === input.kind && folder.kind !== 'custom');
      if (input.id && !previous) throw new Error('FOLDER_AUTHORIZATION_CHANGED');
      if (input.revoke && !previous) return this.snapshot();
      let folders = state.folders.filter(folder => folder.id !== previous?.id);
      if (!input.revoke) {
        const selectedPath = input.path ?? previous!.path;
        const path = await realpath(selectedPath);
        if (path !== selectedPath) throw new Error('FOLDER_NOT_AVAILABLE');
        if (folders.some(folder => folder.path === path)) throw new Error('FOLDER_ALREADY_AUTHORIZED');
        if (path === parse(path).root || !basename(path) || basename(path).startsWith('.')) throw new Error('FOLDER_NOT_SUPPORTED');
        const metadata = await lstat(path);
        if (!metadata.isDirectory() || previous && !input.path && previous.identity !== fileIdentity(metadata)) throw new Error('FOLDER_NOT_AVAILABLE');
        if (folders.length >= 20) throw new Error('FOLDER_LIMIT_REACHED');
        folders = [...folders, { id: randomUUID(), kind: input.kind ?? previous!.kind, label: basename(path).slice(0, 120),
          mobileIds: [...new Set(input.mobileIds)], path, identity: fileIdentity(metadata) }];
      }
      if (previous) for (const [ref, entry] of this.refs) if (entry.folderId === previous.id) this.refs.delete(ref);
      await writeTextAtomic(this.settingsPath(), JSON.stringify({ folders, revision: state.revision + 1 }), { mode: 0o600, ensureDirMode: 0o700 });
      const snapshot = await this.snapshot();
      await publish(snapshot);
      return snapshot;
    });
    this.updates = task.then(() => undefined, () => undefined);
    return task;
  }

  private async root(folderId: unknown): Promise<LocalGrant> {
    const folder = (await this.load()).folders.find(item => item.id === folderId);
    if (!folder) throw new Error('FOLDER_NOT_AUTHORIZED');
    const info = await lstat(folder.path);
    if (!info.isDirectory() || fileIdentity(info) !== folder.identity || await realpath(folder.path) !== folder.path) {
      throw new Error('FOLDER_NOT_AVAILABLE');
    }
    return folder;
  }

  private async fileAt(folder: LocalGrant, path: string) {
    if (!inside(folder.path, path) || await realpath(path) !== path) throw new Error('FILE_OUTSIDE_AUTHORIZED_FOLDER');
    const info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1) throw new Error('FILE_NOT_AVAILABLE');
    return info;
  }

  private async search(args: Record<string, unknown>, signal: AbortSignal) {
    const folder = await this.root(args.folderId);
    const query = String(args.query).normalize('NFKC').toLowerCase().trim().split(/\s+/u);
    const after = typeof args.modifiedAfter === 'number' ? args.modifiedAfter : 0;
    const before = typeof args.modifiedBefore === 'number' ? args.modifiedBefore : Infinity;
    if (!query[0] || after > before) throw new Error('INVALID_FOLDER_SEARCH');
    const pending = [{ path: folder.path, depth: 0 }];
    const matches: Array<{ name: string; path: string; identity: string; modifiedAt: number; size: number }> = [];
    let entries = 0;
    let truncated = false;
    while (pending.length && !truncated) {
      signal.throwIfAborted();
      const next = pending.pop()!;
      if (await realpath(next.path).catch(() => '') !== next.path) continue;
      const stream = await opendir(next.path).catch(() => undefined);
      if (!stream) {
        if (next.depth === 0) throw new Error('FOLDER_NOT_AVAILABLE');
        continue;
      }
      for await (const entry of stream) {
        signal.throwIfAborted();
        if (++entries > 12_000) { truncated = true; break; }
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const path = join(next.path, entry.name);
        if (entry.isDirectory() && next.depth < 5) pending.push({ path, depth: next.depth + 1 });
        if (!entry.isFile() || !query.every(term => entry.name.normalize('NFKC').toLowerCase().includes(term))) continue;
        const info = await this.fileAt(folder, path).catch(() => undefined);
        if (!info || info.mtimeMs < after || info.mtimeMs > before) continue;
        matches.push({ name: entry.name.slice(0, 255), path, identity: fileIdentity(info), modifiedAt: Math.trunc(info.mtimeMs), size: info.size });
      }
    }
    signal.throwIfAborted();
    await this.root(folder.id);
    matches.sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name));
    const now = Date.now();
    for (const [ref, entry] of this.refs) if (entry.expiresAt <= now) this.refs.delete(ref);
    const files = matches.slice(0, 20).map(({ path, identity, ...item }) => {
      const ref = randomUUID();
      this.refs.set(ref, { folderId: folder.id, path, identity, modifiedAt: item.modifiedAt, size: item.size, expiresAt: now + 10 * 60_000 });
      return { ...item, ref };
    });
    while (this.refs.size > 400) this.refs.delete(this.refs.keys().next().value!);
    return { folderId: folder.id, folder: folder.label, files, truncated: truncated || matches.length > files.length };
  }

  private async read(args: Record<string, unknown>, signal: AbortSignal) {
    const folder = await this.root(args.folderId);
    const entry = this.refs.get(String(args.ref));
    if (!entry || entry.folderId !== folder.id || entry.expiresAt <= Date.now()) throw new Error('FILE_REFERENCE_EXPIRED');
    if (entry.size > ENDPOINT_MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    await this.fileAt(folder, entry.path);
    const handle = await open(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const matches = (info: Stats) =>
        info.isFile() && info.nlink === 1 && fileIdentity(info) === entry.identity
        && info.size === entry.size && Math.trunc(info.mtimeMs) === entry.modifiedAt;
      if (!matches(await handle.stat())) throw new Error('FILE_CHANGED');
      const bytes = Buffer.alloc(entry.size);
      try {
        let offset = 0;
        while (offset < bytes.length) {
          signal.throwIfAborted();
          const { bytesRead } = await handle.read({ buffer: bytes, offset, length: bytes.length - offset, position: offset });
          if (!bytesRead) break;
          offset += bytesRead;
        }
        if (offset !== bytes.length || !matches(await handle.stat()) || !matches(await this.fileAt(folder, entry.path))) {
          throw new Error('FILE_CHANGED');
        }
        signal.throwIfAborted();
        await this.root(folder.id);
        return { bytes, name: basename(entry.path), mimeType: this.mimeType(extname(entry.path).toLowerCase()) };
      } catch (error) {
        bytes.fill(0);
        throw error;
      }
    } finally {
      await handle.close();
    }
  }

  definitions(): EndpointToolDefinition[] {
    return deviceFolderDescriptors().map(descriptor => ({ descriptor, execute: async (args, context) => {
      try {
        if (descriptor.name === DEVICE_FOLDER_SEARCH) {
          return { content: [{ type: 'json', value: await this.search(args, context.signal) }] };
        }
        if (descriptor.name !== DEVICE_FOLDER_READ) throw new Error('UNKNOWN_FOLDER_TOOL');
        const file = await this.read(args, context.signal);
        try { return { content: [await context.uploadFile(file)] }; }
        finally { file.bytes.fill(0); }
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) throw error;
        throw new Error('FOLDER_OR_FILE_NOT_AVAILABLE');
      }
    } }));
  }
}
