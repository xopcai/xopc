import { createHash } from 'node:crypto';

import {
  TIER1_LOCAL_UNDERSTANDING_SOURCE_IDS,
  type Tier1LocalUnderstandingSourceId,
} from '../local-source-contract.js';
import type {
  LocalSourcePreview,
  UnderstandingSourceCollectionResult,
  UnderstandingSourceItem,
} from '../types.js';
import { collectAiInstructionItems, previewAiInstructionFiles } from './ai-instructions.js';
import { collectChromiumBookmarkItems, previewChromiumBookmarks } from './chromium-bookmarks.js';
import { collectLocalMarkdownNoteItems, previewLocalMarkdownNotes } from './local-notes.js';
import { collectObsidianItems, previewObsidianVaults } from './obsidian-vaults.js';
import { collectRecentFileItems, previewRecentFiles } from './recent-files.js';

export * from './ai-instructions.js';
export * from './chromium-bookmarks.js';
export * from './local-notes.js';
export * from './obsidian-vaults.js';
export * from './recent-files.js';

export interface Tier1CollectionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
  excludeIds?: string[];
  customNoteDirectories?: string[];
}

export function fingerprintUnderstandingItems(items: UnderstandingSourceItem[]): string {
  const stable = items.map((item) => ({
    id: item.id,
    title: item.title,
    group: item.group ?? '',
    resourceUri: item.resourceUri ?? '',
    occurredAt: item.occurredAt ?? 0,
    modifiedAt: item.modifiedAt ?? 0,
    startsAt: item.startsAt ?? 0,
    endsAt: item.endsAt ?? 0,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export async function collectTier1Source(
  sourceId: Tier1LocalUnderstandingSourceId,
  options: Tier1CollectionOptions = {},
): Promise<UnderstandingSourceCollectionResult> {
  try {
    let items: UnderstandingSourceItem[];
    if (sourceId === 'local-ai-instructions') {
      items = await collectAiInstructionItems({ homeDirectory: options.homeDirectory });
    } else if (sourceId === 'local-obsidian') {
      items = await collectObsidianItems(options);
    } else if (sourceId === 'local-markdown-notes') {
      items = await collectLocalMarkdownNoteItems({
        homeDirectory: options.homeDirectory,
        platform: options.platform,
        environment: options.environment,
        customDirectories: options.customNoteDirectories,
        nowMs: options.nowMs,
        excludeIds: options.excludeIds,
      });
    } else if (sourceId === 'local-recent-files') {
      items = await collectRecentFileItems(options);
    } else {
      items = await collectChromiumBookmarkItems(options);
    }
    return {
      sourceId,
      status: 'completed',
      items,
      checkpoint: {
        fingerprint: fingerprintUnderstandingItems(items),
        collectedAt: options.nowMs ?? Date.now(),
      },
    };
  } catch (error) {
    return {
      sourceId,
      status: 'failed',
      items: [],
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
}

export async function collectTier1Sources(
  sourceIds: readonly Tier1LocalUnderstandingSourceId[],
  options: Tier1CollectionOptions = {},
): Promise<UnderstandingSourceCollectionResult[]> {
  const unique = [...new Set(sourceIds)];
  return Promise.all(unique.map((sourceId) => collectTier1Source(sourceId, options)));
}

export async function previewTier1Sources(
  options: Tier1CollectionOptions = {},
): Promise<LocalSourcePreview[]> {
  const results = await Promise.allSettled([
    previewAiInstructionFiles({ homeDirectory: options.homeDirectory }),
    previewObsidianVaults(options),
    previewLocalMarkdownNotes({
      homeDirectory: options.homeDirectory,
      platform: options.platform,
      environment: options.environment,
      customDirectories: options.customNoteDirectories,
      nowMs: options.nowMs,
    }),
    previewRecentFiles(options),
    previewChromiumBookmarks(options),
  ]);
  return results.map((result, index) => (
    result.status === 'fulfilled'
      ? result.value
      : { sourceId: TIER1_LOCAL_UNDERSTANDING_SOURCE_IDS[index]!, detected: false, itemCount: 0 }
  ));
}
