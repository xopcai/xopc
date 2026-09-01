import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';

import { resolveMcpOAuthPath } from '../../../config/paths.js';
import { writeTextAtomic } from '../../../infra/write-file-atomic.js';
import type { McpOAuthRecord } from './mcp-oauth-types.js';

const writeTails = new Map<string, Promise<void>>();

export function canonicalMcpServerUrl(input: string | URL): string {
  const url = input instanceof URL ? new URL(input) : new URL(input);
  url.hash = '';
  return url.toString();
}

export function mcpOAuthServerKey(input: string | URL): string {
  return createHash('sha256').update(canonicalMcpServerUrl(input)).digest('hex');
}

function isStoredRecord(value: unknown, serverUrl: string): value is McpOAuthRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<McpOAuthRecord>;
  if (record.version !== 1 || record.serverUrl !== serverUrl || typeof record.updatedAt !== 'string') {
    return false;
  }
  if (record.tokens !== undefined) {
    const tokens = record.tokens as { access_token?: unknown; token_type?: unknown };
    if (typeof tokens.access_token !== 'string' || typeof tokens.token_type !== 'string') return false;
  }
  return true;
}

async function serializeWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  writeTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (writeTails.get(key) === tail) writeTails.delete(key);
  }
}

export class McpOAuthStore {
  pathFor(serverUrl: string | URL): string {
    return resolveMcpOAuthPath(mcpOAuthServerKey(serverUrl));
  }

  async load(serverUrlInput: string | URL): Promise<McpOAuthRecord | undefined> {
    const serverUrl = canonicalMcpServerUrl(serverUrlInput);
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(serverUrl), 'utf8')) as unknown;
      return isStoredRecord(parsed, serverUrl) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async update(
    serverUrlInput: string | URL,
    update: (current: McpOAuthRecord | undefined) => McpOAuthRecord | undefined,
  ): Promise<McpOAuthRecord | undefined> {
    const serverUrl = canonicalMcpServerUrl(serverUrlInput);
    const key = mcpOAuthServerKey(serverUrl);
    return serializeWrite(key, async () => {
      const current = await this.load(serverUrl);
      const next = update(current);
      if (!next) {
        await rm(this.pathFor(serverUrl), { force: true });
        return undefined;
      }
      const normalized: McpOAuthRecord = {
        ...next,
        version: 1,
        serverUrl,
        updatedAt: new Date().toISOString(),
      };
      await writeTextAtomic(this.pathFor(serverUrl), JSON.stringify(normalized, null, 2));
      return normalized;
    });
  }

  async delete(serverUrl: string | URL): Promise<void> {
    await this.update(serverUrl, () => undefined);
  }
}
