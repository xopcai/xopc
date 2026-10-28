import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

export const INTAKE_MAX_BYTES = 32 * 1024 * 1024;
export const INTAKE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'docx', 'xlsx', 'pptx'];
export interface ExternalIntakeItem { id: string; name: string; size: number; error?: string }
export interface ExternalIntakeBatch { id: string; createdAt: number; items: ExternalIntakeItem[]; target?: { scope: string; conversationId: string } }

/** Only OS launch arguments enter this function; renderer paths are never accepted. */
export function intakePaths(argv: string[], cwd: string): string[] {
  return argv.filter(arg => !/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) && !arg.startsWith('-') && INTAKE_EXTENSIONS.includes(extname(arg).slice(1).toLowerCase()))
    .map(arg => isAbsolute(arg) ? arg : resolve(cwd, arg));
}

export class ExternalIntakeQueue {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.serial.then(action);
    this.serial = pending.catch(() => {});
    return pending;
  }
  private directory(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid intake ID');
    return join(this.root, id);
  }
  private async save(batch: ExternalIntakeBatch): Promise<void> {
    const directory = this.directory(batch.id);
    await writeFile(join(directory, 'manifest.tmp'), JSON.stringify(batch), { mode: 0o600 });
    await rename(join(directory, 'manifest.tmp'), join(directory, 'manifest.json'));
  }
  async receive(paths: string[]): Promise<void> {
    if (!paths.length) return;
    return this.exclusive(async () => {
      const batch: ExternalIntakeBatch = { id: randomUUID(), createdAt: Date.now(), items: [] };
      const directory = this.directory(batch.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const path of paths) {
        const item: ExternalIntakeItem = { id: randomUUID(), name: basename(path), size: 0 };
        try {
          const source = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
          try {
            const stat = await source.stat();
            if (!stat.isFile()) throw new Error('Only regular files can be attached');
            if (stat.size === 0 || stat.size > INTAKE_MAX_BYTES) throw new Error('File must be between 1 byte and 32 MB');
            item.size = stat.size;
            // Copy through the opened descriptor to avoid reopening a substituted path.
            const chunks: Buffer[] = [];
            let length = 0;
            while (true) {
              const chunk = Buffer.alloc(64 * 1024);
              const { bytesRead } = await source.read(chunk);
              if (!bytesRead) break;
              length += bytesRead;
              if (length > INTAKE_MAX_BYTES) throw new Error('File exceeds 32 MB');
              chunks.push(chunk.subarray(0, bytesRead));
            }
            const bytes = Buffer.concat(chunks, length);
            item.size = bytes.length;
            await writeFile(join(directory, item.id), bytes, { mode: 0o600 });
          } finally { await source.close(); }
        } catch (error) { item.error = error instanceof Error ? error.message : String(error); }
        batch.items.push(item);
      }
      await this.save(batch);
    });
  }
  async list(): Promise<ExternalIntakeBatch[]> {
    return this.exclusive(async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const batches: ExternalIntakeBatch[] = [];
      for (const id of await readdir(this.root)) {
        if (!/^[0-9a-f-]{36}$/.test(id)) continue;
        try {
          const batch = JSON.parse(await readFile(join(this.directory(id), 'manifest.json'), 'utf8')) as ExternalIntakeBatch;
          if (batch.id !== id || !Array.isArray(batch.items)) continue;
          if (!batch.target && Date.now() - batch.createdAt > 24 * 60 * 60 * 1000) await rm(this.directory(id), { recursive: true, force: true });
          else batches.push(batch);
        } catch { /* Incomplete capture is not exposed as a deliverable batch. */ }
      }
      return batches.sort((a, b) => a.createdAt - b.createdAt);
    });
  }
  async read(id: string, itemId: string): Promise<string> {
    return this.exclusive(async () => {
      const batch = JSON.parse(await readFile(join(this.directory(id), 'manifest.json'), 'utf8')) as ExternalIntakeBatch;
      const item = batch.items.find(entry => entry.id === itemId && !entry.error);
      if (!item || !/^[0-9a-f-]{36}$/.test(itemId)) throw new Error('Unknown attachment');
      return (await readFile(join(this.directory(id), itemId))).toString('base64');
    });
  }
  async target(id: string, scope: string, conversationId: string): Promise<void> {
    return this.exclusive(async () => {
      if (typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope) || typeof conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversationId)) throw new Error('Invalid intake target');
      const batch = JSON.parse(await readFile(join(this.directory(id), 'manifest.json'), 'utf8')) as ExternalIntakeBatch;
      if (batch.target && (batch.target.scope !== scope || batch.target.conversationId !== conversationId)) throw new Error('Intake already assigned to another target');
      batch.target = { scope, conversationId };
      await this.save(batch);
    });
  }
  async release(id: string, scope: string): Promise<void> {
    return this.exclusive(async () => {
      const batch = JSON.parse(await readFile(join(this.directory(id), 'manifest.json'), 'utf8')) as ExternalIntakeBatch;
      if (!batch.target || batch.target.scope !== scope) throw new Error('Intake belongs to another connection');
      delete batch.target;
      await this.save(batch);
    });
  }
  async remove(id: string): Promise<void> { return this.exclusive(() => rm(this.directory(id), { recursive: true, force: true })); }
}
