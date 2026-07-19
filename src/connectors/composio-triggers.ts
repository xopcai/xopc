import crypto, { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Config } from '../config/schema.js';
import { getWorkspacePath } from '../config/workspace-path-helpers.js';
import { listConnectorConnections, upsertConnectorConnection } from '../storage/sqlite/connector-repository.js';

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

export function verifyComposioWebhook(input: {
  body: string;
  webhookId: string;
  webhookTimestamp: string;
  signature: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}): unknown {
  if (!input.secret || !input.webhookId || !input.webhookTimestamp || !input.signature) {
    throw new Error('Missing Composio webhook signature fields.');
  }
  const timestampMs = Number(input.webhookTimestamp) * 1000;
  const toleranceMs = (input.toleranceSeconds ?? 300) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs((input.nowMs ?? Date.now()) - timestampMs) > toleranceMs) {
    throw new Error('Composio webhook timestamp is outside the allowed window.');
  }
  const expected = createHmac('sha256', input.secret)
    .update(`${input.webhookId}.${input.webhookTimestamp}.${input.body}`)
    .digest('base64');
  const received = input.signature.split(',').at(-1)?.trim() ?? '';
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new Error('Invalid Composio webhook signature.');
  }
  return JSON.parse(input.body) as unknown;
}

export function normalizeComposioTriggerPayload(payload: unknown, webhookId?: string): {
  id: string;
  type: string;
  toolkit?: string;
  trigger?: string;
  data: Record<string, unknown>;
} {
  const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
    ? row.data as Record<string, unknown>
    : {};
  const toolkitRecord = metadata.toolkit && typeof metadata.toolkit === 'object' && !Array.isArray(metadata.toolkit)
    ? metadata.toolkit as Record<string, unknown>
    : {};
  return {
    id: webhookId ?? readString(row.id ?? row.eventId ?? row.event_id) ?? crypto.randomUUID(),
    type: readString(row.type) ?? 'composio.trigger.message',
    toolkit: readString(metadata.toolkit_slug ?? toolkitRecord.slug ?? row.toolkit ?? row.toolkit_slug),
    trigger: readString(metadata.trigger_slug ?? row.trigger ?? row.triggerName ?? row.trigger_name),
    data,
  };
}

export function applyComposioConnectionLifecycleEvent(payload: unknown): void {
  const normalized = normalizeComposioTriggerPayload(payload);
  if (normalized.type !== 'composio.connected_account.expired' && normalized.type !== 'composio.connected_account.deleted') return;
  const providerConnectionId = readString(normalized.data.id ?? normalized.data.nanoid ?? normalized.data.connected_account_id);
  if (!providerConnectionId) return;
  const connection = listConnectorConnections().find((candidate) => (
    candidate.provider === 'composio' && candidate.providerConnectionId === providerConnectionId
  ));
  if (!connection) return;
  upsertConnectorConnection({
    ...connection,
    status: normalized.type.endsWith('.deleted') ? 'revoked' : 'expired',
    isDefault: false,
    lastError: normalized.type.endsWith('.deleted') ? 'Connection was removed in Composio.' : 'Connection expired and requires authorization.',
  });
}

export async function appendComposioTriggerEvent(config: Config, payload: unknown): Promise<ComposioTriggerArchiveEntry> {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const normalized = normalizeComposioTriggerPayload(payload);
  const entry: ComposioTriggerArchiveEntry = {
    at: new Date().toISOString(),
    id: normalized.id,
    toolkit: normalized.toolkit ?? readString(record.appName ?? record.app_name),
    trigger: normalized.trigger ?? normalized.type,
    payload,
  };
  const path = archivePath(config);
  await mkdir(dirname(path), { recursive: true });
  const recent = await listComposioTriggerEvents(config, 500);
  const existing = recent.find((candidate) => candidate.id === entry.id);
  if (existing) return existing;
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
