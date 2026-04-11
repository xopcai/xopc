import fs from 'node:fs';
import path from 'node:path';

import { resolveWeixinRootDir } from './state-dir.js';

function resolveAccountsDir(): string {
  return path.join(resolveWeixinRootDir(), 'accounts');
}

export function getSyncBufFilePath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.sync.json`);
}

export type SyncBufData = {
  get_updates_buf: string;
};

function readSyncBufFile(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as { get_updates_buf?: string };
    if (typeof data.get_updates_buf === 'string') {
      return data.get_updates_buf;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function loadGetUpdatesBuf(filePath: string): string | undefined {
  return readSyncBufFile(filePath);
}

export function saveGetUpdatesBuf(filePath: string, getUpdatesBuf: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0), 'utf-8');
}
