import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { ConnectedKnowledgePipeline } from '../knowledge/connected-knowledge-pipeline.js';
import {
  getConnectorConnection,
  getConnectorInstallation,
  getKnowledgeSourceItem,
  listKnowledgeSourceItems,
  upsertKnowledgeSourceItems,
} from '../storage/sqlite/index.js';
import type { KnowledgeSourceItem } from '../knowledge/types.js';
import { ComposioSessionsAdapter } from './composio-sessions.js';
import { sanitizeConnectedSourceValue } from './connected-source-sanitization.js';

const MAX_SELECTION = 5;
const MAX_CONTENT_BYTES = 1_000_000;
const MAX_CONTENT_CHARS = 24_000;
const GOOGLE_DOCUMENT_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
const GOOGLE_SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
const EXPORTABLE_GOOGLE_MIMES = new Map<string, string>([
  [GOOGLE_DOCUMENT_MIME, 'text/plain'],
  [GOOGLE_SLIDES_MIME, 'text/plain'],
  [GOOGLE_SHEETS_MIME, 'text/csv'],
]);
const HIGH_SIGNAL_TITLE_RE = /\b(okr|kpi|prd|rfc|roadmap|plan|planning|design|spec|architecture|review|retro|retrospective|weekly|monthly|quarterly|strategy|notes|brief|proposal|summary|goals?)\b|周报|月报|季报|复盘|计划|规划|方案|设计|需求|目标|总结|纪要|评审|路线图/i;
const DOWNLOADABLE_TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/xml',
]);

type ContentReadAdapter = Pick<ComposioSessionsAdapter, 'executeWithPolicy'>;

export type ConnectedContentCandidate = {
  sourceItemId: string;
  sourceInstanceId: string;
  toolkit: 'gmail' | 'googledrive';
  title: string;
  occurredAt?: string;
  mimeType?: string;
};

export type ConnectedContentReadResult = {
  requested: number;
  completed: number;
  failed: Array<{ sourceItemId: string; error: string }>;
  sourceItemIds: string[];
  recordIds: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedRecord(item: KnowledgeSourceItem): Record<string, unknown> {
  if (!item.normalizedText) return {};
  try {
    return record(JSON.parse(item.normalizedText) as unknown);
  } catch {
    return {};
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function candidateFor(item: KnowledgeSourceItem): ConnectedContentCandidate | undefined {
  if (item.deletedAt || item.sensitivity === 'secret' || item.sensitivity === 'regulated') return undefined;
  const toolkit = text(item.metadata.toolkit);
  const value = normalizedRecord(item);
  const title = text(value.title) ?? text(value.subject);
  if (!title) return undefined;
  if (toolkit === 'gmail' && item.itemType === 'email') {
    if (text(value.content)) return undefined;
    return { sourceItemId: item.id, sourceInstanceId: item.sourceInstanceId, toolkit, title, occurredAt: item.occurredAt };
  }
  const mimeType = text(item.metadata.mimeType) ?? text(value.mimeType);
  if (toolkit === 'googledrive' && item.itemType === 'cloud_document'
    && mimeType && (EXPORTABLE_GOOGLE_MIMES.has(mimeType) || DOWNLOADABLE_TEXT_MIMES.has(mimeType))) {
    return {
      sourceItemId: item.id,
      sourceInstanceId: item.sourceInstanceId,
      toolkit,
      title,
      occurredAt: item.occurredAt,
      mimeType,
    };
  }
  return undefined;
}

function candidateScore(item: KnowledgeSourceItem, candidate: ConnectedContentCandidate, nowMs: number): number {
  let score = 0;
  if (item.metadata.actorAttributed === true) score += 3;
  const ts = Date.parse(item.sourceUpdatedAt ?? item.occurredAt ?? '');
  if (Number.isFinite(ts)) {
    const ageDays = Math.max(0, (nowMs - ts) / 86_400_000);
    if (ageDays <= 14) score += 3;
    else if (ageDays <= 45) score += 2;
    else if (ageDays <= 90) score += 1;
  }
  if (HIGH_SIGNAL_TITLE_RE.test(candidate.title)) score += 2.5;
  if (candidate.mimeType === GOOGLE_DOCUMENT_MIME
    || candidate.mimeType === 'text/markdown'
    || candidate.mimeType === 'text/plain') {
    score += 1;
  } else if (candidate.mimeType === GOOGLE_SLIDES_MIME) {
    score += 0.6;
  }
  return score;
}

export function listConnectedContentCandidates(options: {
  agentId: string;
  sourceInstanceId?: string;
  limit?: number;
}): ConnectedContentCandidate[] {
  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const items = listKnowledgeSourceItems({
    agentId: options.agentId,
    ...(options.sourceInstanceId ? { sourceInstanceId: options.sourceInstanceId } : {}),
    includeDeleted: false,
    limit: 500,
  });
  const completedReads = new Set(items
    .map((item) => text(item.metadata.sourceMetadataItemId))
    .filter((id): id is string => Boolean(id)));
  const nowMs = Date.now();
  return items
    .filter((item) => !completedReads.has(item.id))
    .flatMap((item) => {
      const candidate = candidateFor(item);
      return candidate ? [{ candidate, score: candidateScore(item, candidate, nowMs) }] : [];
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.candidate)
    .slice(0, limit);
}

function contentRecipe(item: KnowledgeSourceItem): { actionId: string; args: Record<string, unknown>; mode: 'inline' | 'file' } {
  const toolkit = text(item.metadata.toolkit);
  if (toolkit === 'gmail' && item.itemType === 'email') {
    return { actionId: 'GMAIL_GET_EMAIL', args: { message_id: item.externalId }, mode: 'inline' };
  }
  const value = normalizedRecord(item);
  const mimeType = text(item.metadata.mimeType) ?? text(value.mimeType);
  const exportMime = mimeType ? EXPORTABLE_GOOGLE_MIMES.get(mimeType) : undefined;
  if (toolkit === 'googledrive' && item.itemType === 'cloud_document' && exportMime) {
    return {
      actionId: 'GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE',
      args: { fileId: item.externalId, mimeType: exportMime },
      mode: 'file',
    };
  }
  if (toolkit === 'googledrive' && item.itemType === 'cloud_document' && mimeType && DOWNLOADABLE_TEXT_MIMES.has(mimeType)) {
    return { actionId: 'GOOGLEDRIVE_DOWNLOAD_FILE', args: { file_id: item.externalId }, mode: 'file' };
  }
  throw new Error('This source item does not support bounded content reading.');
}

function collectInlineText(value: unknown, output: string[], depth = 0): void {
  if (depth > 8 || output.join('\n').length >= MAX_CONTENT_CHARS) return;
  if (Array.isArray(value)) {
    for (const item of value) collectInlineText(item, output, depth + 1);
    return;
  }
  const row = record(value);
  for (const [key, nested] of Object.entries(row)) {
    if (typeof nested === 'string' && ['body', 'content', 'plainText', 'plain_text', 'snippet', 'text'].includes(key)) {
      if (nested.trim()) output.push(nested.trim());
      continue;
    }
    if (nested && typeof nested === 'object') collectInlineText(nested, output, depth + 1);
  }
}

function inlineContent(result: unknown): string {
  const values: string[] = [];
  collectInlineText(result, values);
  return [...new Set(values)].join('\n\n').slice(0, MAX_CONTENT_CHARS);
}

function candidateFilePaths(value: unknown, output: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === 'string') {
    if (value.startsWith('file://')) output.push(new URL(value).pathname);
    else if (isAbsolute(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) candidateFilePaths(item, output, depth + 1);
    return;
  }
  for (const nested of Object.values(record(value))) candidateFilePaths(nested, output, depth + 1);
}

async function downloadedContent(result: unknown, downloadDirectory: string): Promise<string> {
  const directory = await realpath(downloadDirectory);
  const paths: string[] = [];
  candidateFilePaths(result, paths);
  for (const path of paths) {
    const resolved = await realpath(path).catch(() => undefined);
    if (!resolved) continue;
    const pathFromDirectory = relative(directory, resolved);
    if (pathFromDirectory.startsWith(`..${sep}`) || pathFromDirectory === '..' || isAbsolute(pathFromDirectory)) continue;
    const content = await readFile(resolved);
    if (content.byteLength > MAX_CONTENT_BYTES) throw new Error('Downloaded content exceeds the 1 MB read limit.');
    return content.toString('utf8').slice(0, MAX_CONTENT_CHARS);
  }
  throw new Error('The connector did not return readable text content.');
}

function updatedSourceItem(item: KnowledgeSourceItem, content: string, actionId: string) {
  const contentReadAt = new Date().toISOString();
  const sanitizedContent = String(sanitizeConnectedSourceValue(content));
  const normalizedText = JSON.stringify({
    ...normalizedRecord(item),
    content: sanitizedContent,
    contentReadAt,
  });
  return {
    sourceInstanceId: item.sourceInstanceId,
    collectionScope: 'content-reads',
    externalId: item.id,
    itemType: 'connected_content',
    authorRole: item.authorRole,
    occurredAt: item.occurredAt,
    sourceUpdatedAt: item.sourceUpdatedAt,
    contentHash: createHash('sha256').update(normalizedText).digest('hex'),
    normalizedText,
    payloadRef: item.payloadRef,
    metadata: {
      ...item.metadata,
      explicitContentRead: true,
      sourceMetadataItemId: item.id,
      contentReadActionId: actionId,
      contentReadAt,
    },
    sensitivity: item.sensitivity,
    retentionClass: 'bounded' as const,
    synthesisPipeline: 'connected_knowledge' as const,
    synthesisStatus: 'pending' as const,
  };
}

export async function readConnectedContent(input: {
  sourceItemIds: string[];
  agentId: string;
  adapterFactory?: (downloadDirectory: string) => ContentReadAdapter;
}): Promise<ConnectedContentReadResult> {
  const sourceItemIds = [...new Set(input.sourceItemIds.map((id) => id.trim()).filter(Boolean))];
  if (!sourceItemIds.length || sourceItemIds.length > MAX_SELECTION) {
    throw new Error(`Select between 1 and ${MAX_SELECTION} source items.`);
  }
  const downloadDirectory = await mkdtemp(join(tmpdir(), 'xopc-content-read-'));
  const adapter = input.adapterFactory?.(downloadDirectory)
    ?? new ComposioSessionsAdapter({ fileDownloadDir: downloadDirectory });
  const result: ConnectedContentReadResult = {
    requested: sourceItemIds.length,
    completed: 0,
    failed: [],
    sourceItemIds: [],
    recordIds: [],
  };
  const updatedSources = new Set<string>();
  const completedReads = new Set(listKnowledgeSourceItems({ agentId: input.agentId, includeDeleted: false, limit: 500 })
    .map((item) => text(item.metadata.sourceMetadataItemId))
    .filter((id): id is string => Boolean(id)));
  try {
    for (const sourceItemId of sourceItemIds) {
      try {
        const item = getKnowledgeSourceItem(sourceItemId);
        if (!item || item.deletedAt || item.metadata.agentId !== input.agentId) throw new Error('Source item is unavailable.');
        if (completedReads.has(item.id)) throw new Error('Source item content was already read.');
        if (!candidateFor(item)) throw new Error('Source item is not eligible for content reading.');
        const connectorId = text(item.metadata.connectorId);
        const connectionId = text(item.metadata.connectionId);
        const toolkit = text(item.metadata.toolkit);
        if (!connectorId || !connectionId || !toolkit) throw new Error('Source item has incomplete connector provenance.');
        const connection = getConnectorConnection(connectionId);
        const installation = getConnectorInstallation(`${connectorId}-local-owner`);
        if (!connection || connection.status !== 'active' || !installation?.enabled) {
          throw new Error('The connected account is not active.');
        }
        const recipe = contentRecipe(item);
        const execution = await adapter.executeWithPolicy({
          context: { principalId: connection.principalId, toolkits: [toolkit] },
          installation: { ...installation, maxScope: 'read', confirmationPolicy: 'always' },
          connection,
          agentId: input.agentId,
          action: {
            connectorId,
            actionId: recipe.actionId,
            toolkit,
            scope: 'read',
            curated: true,
            cachedAt: new Date().toISOString(),
          },
          args: recipe.args,
          confirmed: true,
        });
        if (execution.decision !== 'allowed') throw new Error(execution.reason);
        const content = recipe.mode === 'inline'
          ? inlineContent(execution.result)
          : await downloadedContent(execution.result, downloadDirectory);
        if (!content.trim()) throw new Error('The connector returned empty text content.');
        const stored = upsertKnowledgeSourceItems([updatedSourceItem(item, content, recipe.actionId)]);
        result.sourceItemIds.push(...stored.changedItemIds);
        completedReads.add(item.id);
        updatedSources.add(item.sourceInstanceId);
        result.completed += 1;
      } catch (error) {
        result.failed.push({ sourceItemId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const sourceInstanceId of updatedSources) {
      const item = listKnowledgeSourceItems({ sourceInstanceId, synthesisStatus: 'pending', limit: 1 })[0];
      if (!item) continue;
      const pipeline = new ConnectedKnowledgePipeline({
        agentId: input.agentId,
        workspaceId: text(item.metadata.workspaceId) ?? 'default',
      });
      const synthesized = await pipeline.processPending(sourceInstanceId);
      result.recordIds.push(...synthesized.recordIds);
    }
    return result;
  } finally {
    await rm(downloadDirectory, { recursive: true, force: true });
  }
}
