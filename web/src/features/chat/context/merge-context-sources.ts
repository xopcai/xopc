import type { SessionContextSource } from '@xopcai/gateway-contract';

import type { ComposerAttachmentSummary, ComposerContextRef } from '@/features/chat/composer/composer.types';

export interface DisplayContextSource extends SessionContextSource {
  pending: boolean;
}

/** Merge server associations with the unsent composer draft without changing source lifetime. */
export function mergeContextSources(
  sources: SessionContextSource[],
  drafts: ComposerContextRef[],
  attachments: ComposerAttachmentSummary[] = [],
  page?: ComposerAttachmentSummary | null,
): DisplayContextSource[] {
  const result = new Map<string, DisplayContextSource>();
  for (const source of sources) result.set(`${source.kind}:${source.id}`, { ...source, pending: false });
  const addPending = (kind: DisplayContextSource['kind'], id: string, title: string, fileKind?: 'file' | 'directory') => {
    const key = `${kind}:${id}`;
    const existing = result.get(key);
    if (existing) {
      existing.pending = true;
      return;
    }
    result.set(key, { kind, id, title, ...(fileKind ? { fileKind } : {}), origins: [], pending: true });
  };
  for (const draft of drafts) addPending(draft.kind, draft.sourceId, draft.title, draft.fileKind);
  for (const attachment of attachments) addPending('attachment', attachment.id, attachment.title);
  if (page) addPending('app_context', page.id, page.title);
  return [...result.values()];
}
