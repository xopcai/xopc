import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SessionCreation, SessionInputCommand, SessionMaterializeCommand } from '@xopcai/gateway-contract';
import { resolveStateDir } from '../../config/paths.js';
import type { SessionAgentConfig } from '../../session/config-types.js';

export interface EmbeddedDraft {
  creation: SessionCreation;
  config: SessionAgentConfig;
  command?: Extract<SessionInputCommand, { kind: 'start' }>;
  materialization?: SessionMaterializeCommand;
  ownerPid?: number;
}

/** Draft files are private client state, never session/transcript rows. */
export class TuiDraftFileStore<T> {
  constructor(private readonly directory = join(resolveStateDir(), 'client-drafts', 'embedded')) {}

  private path(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error('Invalid conversation UUID');
    return join(this.directory, `${id}.json`);
  }

  read(id: string): T | undefined {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return undefined;
    try { return JSON.parse(readFileSync(this.path(id), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  save(id: string, draft: T): void {
    const path = this.path(id);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(draft), { mode: 0o600 });
      renameSync(temporary, path);
    } finally {
      try { unlinkSync(temporary); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  remove(id: string): void {
    try { unlinkSync(this.path(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export class EmbeddedDraftStore extends TuiDraftFileStore<EmbeddedDraft> {}
