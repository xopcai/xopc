import { createHash } from 'node:crypto';

import { transcriptRowsToClientHistory } from '../session/client-history.js';
import type { TranscriptSourceEntry } from '../storage/sqlite/index.js';

export interface SessionShareMessage {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt: string;
  attachmentIds: string[];
}

export interface SessionShareToolActivity {
  id: string;
  messageId?: string;
  toolName: string;
  status: 'completed' | 'failed';
  createdAt: string;
}

export interface SessionShareAttachmentCandidate {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface SessionShareProjection {
  messages: SessionShareMessage[];
  toolActivities: SessionShareToolActivity[];
  attachmentCandidates: SessionShareAttachmentCandidate[];
  /** Internal lookup used only while copying explicitly selected media. */
  attachmentUris: Map<string, string>;
}

/** Closed public projection. Tool arguments/results and raw media references never leave this boundary. */
export function projectSessionShare(entries: TranscriptSourceEntry[]): SessionShareProjection {
  const history = transcriptRowsToClientHistory(entries.map((entry) => entry.row));
  const messages: SessionShareMessage[] = [];
  const toolActivities: SessionShareToolActivity[] = [];
  const attachmentCandidates: SessionShareAttachmentCandidate[] = [];
  const attachmentUris = new Map<string, string>();

  for (const item of history) {
    const rowNumber = parseRowNumber(item.id);
    const source = rowNumber === null ? undefined : entries[rowNumber - 1];
    const createdAt = new Date(source?.createdAt ?? item.timestamp ?? Date.now()).toISOString();

    if (item.kind === 'bash') {
      if (item.bash?.exitCode === undefined) continue;
      toolActivities.push({
        id: `activity-${toolActivities.length + 1}`,
        toolName: 'shell',
        status: item.bash?.exitCode === 0 ? 'completed' : 'failed',
        createdAt,
      });
      continue;
    }
    if (item.kind !== 'message' || (item.role !== 'user' && item.role !== 'assistant')) continue;

    const messageId = `message-${messages.length + 1}`;
    const messageAttachmentIds: string[] = [];
    for (const media of item.media ?? []) {
      const uri = typeof media.uri === 'string' ? media.uri.trim() : '';
      if (!uri) continue;
      const id = attachmentId(messageId, uri);
      messageAttachmentIds.push(id);
      if (attachmentUris.has(id)) continue;
      attachmentUris.set(id, uri);
      attachmentCandidates.push({
        id,
        messageId,
        fileName: media.name?.trim() || 'attachment',
        mimeType: media.mimeType?.trim() || 'application/octet-stream',
        size: Number.isFinite(media.size) && media.size >= 0 ? media.size : 0,
      });
    }

    const hasMessage = Boolean(item.content.trim()) || messageAttachmentIds.length > 0;
    if (hasMessage) {
      messages.push({
        id: messageId,
        role: item.role,
        markdown: item.content,
        createdAt,
        attachmentIds: messageAttachmentIds,
      });
    }
    if (item.role === 'assistant') {
      for (const tool of item.toolCalls ?? []) {
        if (tool.result === undefined && tool.isError === undefined) continue;
        toolActivities.push({
          id: `activity-${toolActivities.length + 1}`,
          ...(hasMessage ? { messageId } : {}),
          toolName: tool.name.trim().slice(0, 100) || 'tool',
          status: tool.isError ? 'failed' : 'completed',
          createdAt,
        });
      }
    }
  }

  return { messages, toolActivities, attachmentCandidates, attachmentUris };
}

function attachmentId(messageId: string, uri: string): string {
  return `attachment-${createHash('sha256').update(messageId).update('\0').update(uri).digest('hex').slice(0, 24)}`;
}

function parseRowNumber(id: string | undefined): number | null {
  const match = /^row-(\d+)$/.exec(id ?? '');
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
