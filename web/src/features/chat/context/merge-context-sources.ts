import type { SessionContextSource } from '@xopcai/gateway-contract';

import type { ComposerContextRef } from '@/features/chat/composer/composer.types';

export function mergeContextSources(sources: SessionContextSource[], drafts: ComposerContextRef[]) {
  const result = sources.map((source) => ({ ...source, drafts: [] as ComposerContextRef[] }));
  for (const draft of drafts) {
    const found = result.find((source) => source.id === draft.sourceId);
    if (found) found.drafts.push(draft);
    else result.push({ kind: 'note', id: draft.sourceId, title: draft.title, origins: [], drafts: [draft] });
  }
  return result;
}
