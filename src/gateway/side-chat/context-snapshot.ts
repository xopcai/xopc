import { createHash } from 'node:crypto';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { SideChatContextSnapshot, SideChatSelection } from './types.js';

const MAX_SELECTIONS = 20;
const MAX_SELECTION_CHARS = 32_000;
const MAX_TOTAL_SELECTION_CHARS = 128_000;

function selectionText(selection: SideChatSelection): string {
  switch (selection.type) {
    case 'message': return selection.content;
    case 'text': return selection.text;
    case 'file-range': return selection.text;
    case 'diff': return selection.diff;
  }
}

export function validateSideChatSelections(value: unknown): SideChatSelection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('selections must be an array');
  if (value.length > MAX_SELECTIONS) throw new Error(`selections cannot exceed ${MAX_SELECTIONS} items`);

  let totalChars = 0;
  const selections = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new Error(`selection ${index} must be an object`);
    const selection = candidate as Record<string, unknown>;
    const id = typeof selection.id === 'string' ? selection.id.trim() : '';
    const type = selection.type;
    if (!id) throw new Error(`selection ${index} requires id`);

    let normalized: SideChatSelection;
    if (type === 'message') {
      normalized = {
        id,
        type,
        messageId: requiredString(selection.messageId, `selection ${index} messageId`),
        role: requiredString(selection.role, `selection ${index} role`),
        content: requiredString(selection.content, `selection ${index} content`),
        label: optionalString(selection.label),
      };
    } else if (type === 'text') {
      normalized = {
        id,
        type,
        text: requiredString(selection.text, `selection ${index} text`),
        sourceMessageId: optionalString(selection.sourceMessageId),
        label: optionalString(selection.label),
      };
    } else if (type === 'file-range') {
      const startLine = positiveInteger(selection.startLine, `selection ${index} startLine`);
      const endLine = positiveInteger(selection.endLine, `selection ${index} endLine`);
      if (endLine < startLine) throw new Error(`selection ${index} endLine must be >= startLine`);
      normalized = {
        id,
        type,
        path: requiredString(selection.path, `selection ${index} path`),
        startLine,
        endLine,
        text: requiredString(selection.text, `selection ${index} text`),
        contentHash: optionalString(selection.contentHash),
        label: optionalString(selection.label),
      };
    } else if (type === 'diff') {
      normalized = {
        id,
        type,
        diff: requiredString(selection.diff, `selection ${index} diff`),
        path: optionalString(selection.path),
        label: optionalString(selection.label),
      };
    } else {
      throw new Error(`selection ${index} has unsupported type`);
    }

    const chars = selectionText(normalized).length;
    if (chars > MAX_SELECTION_CHARS) throw new Error(`selection ${index} exceeds ${MAX_SELECTION_CHARS} characters`);
    totalChars += chars;
    return normalized;
  });

  if (totalChars > MAX_TOTAL_SELECTION_CHARS) {
    throw new Error(`selection content exceeds ${MAX_TOTAL_SELECTION_CHARS} characters`);
  }
  return selections;
}

export function createSideChatContextSnapshot(params: {
  parentSessionKey: string;
  parentSessionId: string;
  parentMessages: readonly AgentMessage[];
  selections: readonly SideChatSelection[];
  createdAt: string;
}): SideChatContextSnapshot {
  const selections = structuredClone(params.selections) as SideChatSelection[];
  const digest = createHash('sha256')
    .update(JSON.stringify({ messages: params.parentMessages, selections }))
    .digest('hex');
  return {
    parentSessionKey: params.parentSessionKey,
    parentSessionId: params.parentSessionId,
    parentMessageCount: params.parentMessages.length,
    createdAt: params.createdAt,
    selections,
    contentHash: digest,
  };
}

export function formatSideChatSelections(selections: readonly SideChatSelection[]): string | null {
  if (selections.length === 0) return null;
  const sections = selections.map((selection, index) => {
    const title = selection.label || `${selection.type} ${index + 1}`;
    if (selection.type === 'file-range') {
      return `### ${title}\nSource: ${selection.path}:${selection.startLine}-${selection.endLine}\n\n${selection.text}`;
    }
    if (selection.type === 'message') {
      return `### ${title}\nSource message: ${selection.messageId} (${selection.role})\n\n${selection.content}`;
    }
    if (selection.type === 'diff') {
      return `### ${title}${selection.path ? `\nSource: ${selection.path}` : ''}\n\n${selection.diff}`;
    }
    return `### ${title}${selection.sourceMessageId ? `\nSource message: ${selection.sourceMessageId}` : ''}\n\n${selection.text}`;
  });
  return `The user attached the following immutable context snapshot to this side chat:\n\n${sections.join('\n\n')}`;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}
