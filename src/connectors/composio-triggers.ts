import crypto from 'node:crypto';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';

export type ComposioTriggerArchiveEntry = {
  at: string;
  id: string;
  toolkit?: string;
  trigger?: string;
  payload: unknown;
};

function archivePath(config: Config): string {
  const workspace = getWorkspacePath(config) || './workspace';
  return join(workspace, 'state', 'connectors', 'composio-triggers.jsonl');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function appendComposioTriggerEvent(config: Config, payload: unknown): Promise<ComposioTriggerArchiveEntry> {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const entry: ComposioTriggerArchiveEntry = {
    at: new Date().toISOString(),
    id: readString(record.id ?? record.eventId ?? record.event_id) ?? crypto.randomUUID(),
    toolkit: readString(record.toolkit ?? record.toolkit_slug ?? record.appName ?? record.app_name),
    trigger: readString(record.trigger ?? record.triggerName ?? record.trigger_name ?? record.type),
    payload,
  };
  const path = archivePath(config);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export async function listComposioTriggerEvents(config: Config, limit = 50): Promise<ComposioTriggerArchiveEntry[]> {
  const path = archivePath(config);
  const text = await readFile(path, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(limit, 500)))
    .map((line) => JSON.parse(line) as ComposioTriggerArchiveEntry)
    .reverse();
}
