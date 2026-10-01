import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { writeTextAtomic } from '../../src/infra/write-file-atomic.js';

const AppId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9._-]+$/);
const Policy = z.object({ version: z.literal(1), authorizedAppIds: z.array(AppId).max(200) }).strict();

/** A local owner decision. Gateway configuration and model output cannot write this file. */
export class ComputerAccessPolicy {
  private readonly path = join(app.getPath('userData'), 'computer-access-policy.json');
  private authorized = new Set<string>();
  private loading?: Promise<void>;

  async load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const parsed = Policy.parse(JSON.parse(await readFile(this.path, 'utf8')));
        this.authorized = new Set(parsed.authorizedAppIds);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })();
    return this.loading;
  }

  async list(): Promise<string[]> { await this.load(); return [...this.authorized].sort(); }
  async allows(appId: string): Promise<boolean> { await this.load(); return this.authorized.has(appId); }

  async set(appId: string, allowed: boolean): Promise<string[]> {
    AppId.parse(appId);
    await this.load();
    const next = new Set(this.authorized);
    if (allowed) next.add(appId); else next.delete(appId);
    if (next.size > 200) throw new Error('COMPUTER_APP_LIMIT');
    await writeTextAtomic(this.path, JSON.stringify({ version: 1, authorizedAppIds: [...next].sort() }), { mode: 0o600 });
    this.authorized = next;
    return [...next].sort();
  }
}
